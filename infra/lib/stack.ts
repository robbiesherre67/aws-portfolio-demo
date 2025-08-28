import * as path from 'path';
import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';

const ROOT = path.resolve(__dirname, '..', '..');

export class PortfolioStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB
    const table = new dynamodb.Table(this, 'TasksTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY, // demo only
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
      runtimePlatform: {                         // ✅ match image arch
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
      timeout: Duration.seconds(10),
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

    new CfnOutput(this, 'GraphQLEndpoint', { value: `${httpApi.apiEndpoint}/graphql` });
  }
}
