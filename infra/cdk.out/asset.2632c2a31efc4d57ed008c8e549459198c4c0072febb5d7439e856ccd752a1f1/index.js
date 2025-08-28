import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME;
const TASK_ID = process.env.TASK_ID;

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('Worker starting for TASK_ID', TASK_ID);
  await sleep(5000); // simulate heavy work
  await doc.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { id: TASK_ID },
    UpdateExpression: 'SET #s = :s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': 'PROCESSED' }
  }));
  console.log('Worker done');
})();
