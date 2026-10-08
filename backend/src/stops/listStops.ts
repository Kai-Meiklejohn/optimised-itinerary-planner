import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, STOP_TABLE } from '../lib/dynamo.js'
import type { Stop } from './createStop.js'
import { isOrderCounterRow } from './orderCounter.js'

const UNDATED = '9999-99-99'

function compareStops(a: Stop, b: Stop): number {
  const dateA = a.date ?? UNDATED
  const dateB = b.date ?? UNDATED

  if (dateA !== dateB) {
    return dateA < dateB ? -1 : 1
  }

  return a.order - b.order
}

export async function listStops(
  tripId: string,
  client: DynamoDBDocumentClient = docClient,
): Promise<Stop[]> {
  const items: Record<string, unknown>[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const result = await client.send(
      new QueryCommand({
        TableName: STOP_TABLE,
        KeyConditionExpression: 'tripId = :tripId',
        ExpressionAttributeValues: { ':tripId': tripId },
        ExclusiveStartKey: exclusiveStartKey,
        // A stop just added should show up immediately on this same list, not
        // after DynamoDB's eventual-consistency delay.
        ConsistentRead: true,
      }),
    )

    items.push(...(result.Items ?? []))
    exclusiveStartKey = result.LastEvaluatedKey
  } while (exclusiveStartKey)

  const stops = items.filter((item) => !isOrderCounterRow(String(item.stopId))) as Stop[]

  return stops.sort(compareStops)
}
