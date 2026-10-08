import { DeleteCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, STOP_TABLE, TRIP_TABLE } from '../lib/dynamo.js'
import { getTrip } from './getTrip.js'

export async function deleteTrip(
  userId: string,
  tripId: string,
  client: DynamoDBDocumentClient = docClient,
): Promise<boolean> {
  const trip = await getTrip({ userId, tripId }, client)
  if (!trip) {
    return false
  }

  // Mark the trip as deleting before scanning its stops, so a stop creation that's
  // still in flight (already past its own "does the trip exist" check) gets rejected
  // by this flag instead of landing after the scan has already passed it by - closing
  // the gap a plain "does the trip row still exist" check at write time can't.
  try {
    await client.send(
      new UpdateCommand({
        TableName: TRIP_TABLE,
        Key: { userId, tripId },
        UpdateExpression: 'SET deleting = :true',
        ConditionExpression: 'attribute_exists(tripId)',
        ExpressionAttributeValues: { ':true': true },
      }),
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return false
    }
    throw error
  }

  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const stops = await client.send(
      new QueryCommand({
        TableName: STOP_TABLE,
        KeyConditionExpression: 'tripId = :tripId',
        ExpressionAttributeValues: { ':tripId': tripId },
        ExclusiveStartKey: exclusiveStartKey,
        // Strongly consistent: a stop whose create transaction committed just before
        // the deleting flag was set must still be visible here, or an eventually
        // consistent read could miss it and leave it orphaned once the trip row goes.
        ConsistentRead: true,
      }),
    )

    for (const stop of stops.Items ?? []) {
      await client.send(
        new DeleteCommand({
          TableName: STOP_TABLE,
          Key: { tripId, stopId: stop.stopId },
        }),
      )
    }

    exclusiveStartKey = stops.LastEvaluatedKey
  } while (exclusiveStartKey)

  await client.send(
    new DeleteCommand({
      TableName: TRIP_TABLE,
      Key: { userId, tripId },
    }),
  )

  return true
}
