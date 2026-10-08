import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const region = process.env.AWS_REGION ?? 'us-east-1'

const client = new DynamoDBClient({ region })

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

export const TRIP_TABLE = process.env.TRIP_TABLE_NAME ?? 'Trip'
export const STOP_TABLE = process.env.STOP_TABLE_NAME ?? 'Stop'
export const USER_TABLE = process.env.USER_TABLE_NAME ?? 'User'
export const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE_NAME ?? 'RateLimit'
