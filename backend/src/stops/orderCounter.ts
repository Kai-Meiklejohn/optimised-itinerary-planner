import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { STOP_TABLE } from '../lib/dynamo.js'

const ORDER_COUNTER_PREFIX = '#order#'
const UNDATED_COUNTER_KEY = 'undated'
export const ORDER_STEP = 1000

export function isOrderCounterRow(stopId: string): boolean {
  return stopId.startsWith(ORDER_COUNTER_PREFIX)
}

export async function getNextOrder(
  tripId: string,
  date: string | undefined,
  client: DynamoDBDocumentClient,
): Promise<number> {
  const result = await client.send(
    new UpdateCommand({
      TableName: STOP_TABLE,
      Key: { tripId, stopId: `${ORDER_COUNTER_PREFIX}${date ?? UNDATED_COUNTER_KEY}` },
      UpdateExpression: 'ADD orderCounter :step',
      ExpressionAttributeValues: { ':step': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  )

  return (Number(result.Attributes?.orderCounter) || 1) * ORDER_STEP
}
