import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, TRIP_TABLE } from '../lib/dynamo.js'
import type { Trip } from './createTrip.js'

export type GetTripInput = {
  userId: string
  tripId: string
}

export async function getTrip(
  input: GetTripInput,
  client: DynamoDBDocumentClient = docClient,
): Promise<Trip | undefined> {
  const result = await client.send(
    new GetCommand({
      TableName: TRIP_TABLE,
      Key: { userId: input.userId, tripId: input.tripId },
      // Used as the ownership gate right after writes elsewhere (e.g. create a trip,
      // then immediately add its first stop) - an eventually consistent read could
      // otherwise return a false "not found" for a trip that was just created.
      ConsistentRead: true,
    }),
  )

  return result.Item as Trip | undefined
}
