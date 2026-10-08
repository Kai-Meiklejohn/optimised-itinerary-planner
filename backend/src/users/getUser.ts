import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, USER_TABLE } from '../lib/dynamo.js'
import type { User } from './createUser.js'

export async function getUser(
  userId: string,
  client: DynamoDBDocumentClient = docClient,
): Promise<User | undefined> {
  const result = await client.send(
    new GetCommand({
      TableName: USER_TABLE,
      Key: { userId },
      // createUser.ts falls back to this read right after its own conditional
      // write loses a sign-up race - an eventually consistent read here could
      // still miss the winning write and turn a harmless race into a 500.
      ConsistentRead: true,
    }),
  )

  return result.Item as User | undefined
}
