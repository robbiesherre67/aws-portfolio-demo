"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortfolioStack = void 0;
const path = __importStar(require("path"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const lambdaNode = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const apigwv2 = __importStar(require("aws-cdk-lib/aws-apigatewayv2"));
const apigwIntegrations = __importStar(require("aws-cdk-lib/aws-apigatewayv2-integrations"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecrAssets = __importStar(require("aws-cdk-lib/aws-ecr-assets"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const ROOT = path.resolve(__dirname, '..', '..');
class PortfolioStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // DynamoDB
        const table = new dynamodb.Table(this, 'TasksTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY, // demo only
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        });
        // VPC (only public subnets to avoid NAT costs)
        const vpc = new ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            natGateways: 0,
            subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
        });
        // ECS cluster
        const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
        // Build worker image from local Dockerfile
        const workerAsset = new ecrAssets.DockerImageAsset(this, 'WorkerImage', {
            directory: path.join(ROOT, 'worker'),
            platform: ecrAssets.Platform.LINUX_AMD64, // ✅ ensure amd64 image (Apple Silicon fix)
        });
        // Fargate TaskDefinition
        const taskDef = new ecs.FargateTaskDefinition(this, 'WorkerTaskDef', {
            cpu: 256,
            memoryLimitMiB: 512,
            runtimePlatform: {
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            },
        });
        taskDef.addContainer('WorkerContainer', {
            image: ecs.ContainerImage.fromDockerImageAsset(workerAsset),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker' }),
            environment: {
                TABLE_NAME: table.tableName,
            },
        });
        // Allow worker access to DynamoDB
        table.grantReadWriteData(taskDef.taskRole);
        const taskSg = new ec2.SecurityGroup(this, 'TaskSG', {
            vpc,
            allowAllOutbound: true,
        });
        // Lambda: GraphQL API
        const apiFn = new lambdaNode.NodejsFunction(this, 'ApiFn', {
            entry: path.join(ROOT, 'src', 'lambda', 'api.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            timeout: aws_cdk_lib_1.Duration.seconds(10),
            environment: {
                TABLE_NAME: table.tableName,
                CLUSTER_ARN: cluster.clusterArn,
                TASK_DEF_ARN: taskDef.taskDefinitionArn,
                SUBNET_IDS: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnets.map(s => s.subnetId).join(','),
                SECURITY_GROUP_ID: taskSg.securityGroupId,
            },
        });
        table.grantReadWriteData(apiFn);
        // Permissions to run ECS tasks + pass roles
        apiFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ecs:RunTask'],
            resources: [taskDef.taskDefinitionArn],
        }));
        apiFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [taskDef.taskRole.roleArn, taskDef.obtainExecutionRole().roleArn],
        }));
        // API Gateway HTTP API → Lambda
        const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
            corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [apigwv2.CorsHttpMethod.ANY],
                allowHeaders: ['*'],
            },
        });
        const integration = new apigwIntegrations.HttpLambdaIntegration('LambdaIntegration', apiFn);
        httpApi.addRoutes({
            path: '/graphql',
            methods: [apigwv2.HttpMethod.ANY],
            integration,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'GraphQLEndpoint', { value: `${httpApi.apiEndpoint}/graphql` });
    }
}
exports.PortfolioStack = PortfolioStack;
