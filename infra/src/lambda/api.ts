// infra/src/lambda/api.ts
import { ApolloServer, gql } from 'apollo-server-lambda';
import { v4 as uuid } from 'uuid';

import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';

// ---- Env provided by the CDK stack (we'll wire these up) ----
const TABLE_NAME = process.env.TABLE_NAME!;
const CLUSTER_ARN = process.env.CLUSTER_ARN!;
const TASK_DEF_ARN = process.env.TASK_DEF_ARN!;
const SUBNET_IDS = process.env.SUBNET_IDS!;          // comma-separated
const SECURITY_GROUP_ID = process.env.SECURITY_GROUP_ID!;

// ---- AWS clients ----
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const ecs = new ECSClient({});

// ---- GraphQL schema ----
const typeDefs = gql`
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
      const res = await doc.send(new ScanCommand({ TableName: TABLE_NAME }));
      return (res.Items ?? []) as any[];
    },
    task: async (_: unknown, { id }: { id: string }) => {
      const res = await doc.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { id } })
      );
      return res.Item as any;
    },
  },

  Mutation: {
    addTask: async (_: unknown, { title }: { title: string }) => {
      const item = {
        id: uuid(),
        title,
        status: 'NEW',
        createdAt: new Date().toISOString(),
      };
      await doc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return item;
    },

    completeTask: async (_: unknown, { id }: { id: string }) => {
      await doc.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { id },
          UpdateExpression: 'SET #s = :s',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': 'DONE' },
          ReturnValues: 'ALL_NEW',
        })
      );
      const res = await doc.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { id } })
      );
      return res.Item as any;
    },

    startHeavyJob: async (_: unknown, { id }: { id: string }) => {
      // Fire-and-forget a Fargate task that will update this item later
      await ecs.send(
        new RunTaskCommand({
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
        })
      );

      return 'Task started';
    },
  },
};

// ---- Lambda handler ----
const server = new ApolloServer({ typeDefs, resolvers });
export const handler = server.createHandler();
