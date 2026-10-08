import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, RATE_LIMIT_TABLE } from './dynamo.js'
import { RateLimitError, ServiceUnavailableError } from './errors.js'
import { MAX_PLACE_REQUESTS_PER_WINDOW, PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS } from './limits.js'

// One row per user per fixed time window, atomically incremented the same way
// orderCounter.ts counts stops - avoids a read-then-write race entirely. The
// row outlives its own window briefly (rather than being deleted right at the
// boundary) purely so DynamoDB's background TTL sweep - which isn't instant -
// never has to race the next check for the same window.
export async function enforcePlaceRequestRateLimit(
  userId: string,
  client: DynamoDBDocumentClient = docClient,
  now: number = Date.now(),
): Promise<void> {
  const nowSeconds = Math.floor(now / 1000)
  const windowStart = Math.floor(nowSeconds / PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS) * PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS
  const expiresAt = windowStart + PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS * 2

  let requestCount: unknown
  try {
    const result = await client.send(
      new UpdateCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: { userId, window: String(windowStart) },
        UpdateExpression: 'ADD requestCount :one SET expiresAt = :expiresAt',
        ExpressionAttributeValues: { ':one': 1, ':expiresAt': expiresAt },
        ReturnValues: 'UPDATED_NEW',
      }),
    )
    requestCount = result.Attributes?.requestCount
  } catch (error) {
    console.error('Could not check the place-request rate limit:', error)
    throw new ServiceUnavailableError('Place lookups are temporarily unavailable. Please try again later.')
  }

  if (typeof requestCount !== 'number' || !Number.isSafeInteger(requestCount) || requestCount < 1) {
    throw new ServiceUnavailableError('Place lookups are temporarily unavailable. Please try again later.')
  }

  if (requestCount > MAX_PLACE_REQUESTS_PER_WINDOW) {
    throw new RateLimitError('Too many place lookups. Please wait a moment and try again.')
  }
}
