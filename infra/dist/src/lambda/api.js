"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
// infra/src/lambda/api.ts
const apollo_server_lambda_1 = require("apollo-server-lambda");
const uuid_1 = require("uuid");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_ecs_1 = require("@aws-sdk/client-ecs");
// ---- Env provided by the CDK stack (we'll wire these up) ----
const TABLE_NAME = process.env.TABLE_NAME;
const CLUSTER_ARN = process.env.CLUSTER_ARN;
const TASK_DEF_ARN = process.env.TASK_DEF_ARN;
const SUBNET_IDS = process.env.SUBNET_IDS; // comma-separated
const SECURITY_GROUP_ID = process.env.SECURITY_GROUP_ID;
// ---- AWS clients ----
const ddb = new client_dynamodb_1.DynamoDBClient({});
const doc = lib_dynamodb_1.DynamoDBDocumentClient.from(ddb);
const ecs = new client_ecs_1.ECSClient({});
// ---- GraphQL schema ----
const typeDefs = (0, apollo_server_lambda_1.gql) `
  type Task {
    id: ID!
    title: String!
    status: String!
    createdAt: String!
  }

  type Query {
    tasks: [Task!]!
    task(id: ID!): Task
  }

  type Mutation {
    addTask(title: String!): Task!
    completeTask(id: ID!): Task
    startHeavyJob(id: ID!): String!
  }
`;
// ---- Resolvers ----
const resolvers = {
    Query: {
        tasks: async () => {
            const res = await doc.send(new lib_dynamodb_1.ScanCommand({ TableName: TABLE_NAME }));
            return (res.Items ?? []);
        },
        task: async (_, { id }) => {
            const res = await doc.send(new lib_dynamodb_1.GetCommand({ TableName: TABLE_NAME, Key: { id } }));
            return res.Item;
        },
    },
    Mutation: {
        addTask: async (_, { title }) => {
            const item = {
                id: (0, uuid_1.v4)(),
                title,
                status: 'NEW',
                createdAt: new Date().toISOString(),
            };
            await doc.send(new lib_dynamodb_1.PutCommand({ TableName: TABLE_NAME, Item: item }));
            return item;
        },
        completeTask: async (_, { id }) => {
            await doc.send(new lib_dynamodb_1.UpdateCommand({
                TableName: TABLE_NAME,
                Key: { id },
                UpdateExpression: 'SET #s = :s',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: { ':s': 'DONE' },
                ReturnValues: 'ALL_NEW',
            }));
            const res = await doc.send(new lib_dynamodb_1.GetCommand({ TableName: TABLE_NAME, Key: { id } }));
            return res.Item;
        },
        startHeavyJob: async (_, { id }) => {
            // Fire-and-forget a Fargate task that will update this item later
            await ecs.send(new client_ecs_1.RunTaskCommand({
                cluster: CLUSTER_ARN,
                taskDefinition: TASK_DEF_ARN,
                count: 1,
                launchType: 'FARGATE',
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: SUBNET_IDS.split(','),
                        securityGroups: [SECURITY_GROUP_ID],
                        assignPublicIp: 'ENABLED',
                    },
                },
                overrides: {
                    containerOverrides: [
                        {
                            name: 'WorkerContainer',
                            environment: [
                                { name: 'TABLE_NAME', value: TABLE_NAME },
                                { name: 'TASK_ID', value: id },
                            ],
                        },
                    ],
                },
            }));
            return 'Task started';
        },
    },
};
// ---- Lambda handler ----
const server = new apollo_server_lambda_1.ApolloServer({ typeDefs, resolvers });
exports.handler = server.createHandler();
