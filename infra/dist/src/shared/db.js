"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doc = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const ddb = new client_dynamodb_1.DynamoDBClient({});
exports.doc = lib_dynamodb_1.DynamoDBDocumentClient.from(ddb);
