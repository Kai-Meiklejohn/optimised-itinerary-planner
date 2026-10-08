import { DeleteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, STOP_TABLE } from '../lib/dynamo.js'

export async function deleteStop(
  tripId: string,
  stopId: string,
  client: DynamoDBDocumentClient = docClient,
): Promise<void> {
  await client.send(
    new DeleteCommand({
      TableName: STOP_TABLE,
      Key: { tripId, stopId },
    }),
  )
}
