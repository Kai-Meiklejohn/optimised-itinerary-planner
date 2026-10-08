import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, TRIP_TABLE } from '../lib/dynamo.js'
import type { Trip } from './createTrip.js'

export async function listTrips(
  userId: string,
  client: DynamoDBDocumentClient = docClient,
): Promise<Trip[]> {
  const trips: Trip[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const result = await client.send(
      new QueryCommand({
        TableName: TRIP_TABLE,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ExclusiveStartKey: exclusiveStartKey,
        // A trip just created or renamed should show up immediately on this
        // same list, not after DynamoDB's eventual-consistency delay.
        ConsistentRead: true,
      }),
    )

    trips.push(...((result.Items ?? []) as Trip[]))
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)

  return trips.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}
