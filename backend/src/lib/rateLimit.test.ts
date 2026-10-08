import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { enforcePlaceRequestRateLimit } from './rateLimit.js'
import { RateLimitError } from './errors.js'
import { MAX_PLACE_REQUESTS_PER_WINDOW, PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS } from './limits.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('enforcePlaceRequestRateLimit', () => {
  it('allows a request under the limit and keys the row by user and time window', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: 1 } })

    const now = 1_000_000_000_000
    await enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient, now)

    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input
    const expectedWindow = Math.floor(Math.floor(now / 1000) / PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS) * PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS
    expect(call.Key).toEqual({ userId: 'user-1', window: String(expectedWindow) })
    expect(call.UpdateExpression).toBe('ADD requestCount :one SET expiresAt = :expiresAt')
  })

  it('rejects once the count for the current window exceeds the limit', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: MAX_PLACE_REQUESTS_PER_WINDOW + 1 } })

    await expect(
      enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient),
    ).rejects.toThrow(RateLimitError)
  })

  it('allows a request exactly at the limit', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: MAX_PLACE_REQUESTS_PER_WINDOW } })

    await expect(
      enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient),
    ).resolves.toBeUndefined()
  })

  it('keys different time windows to different rows, so the count resets over time', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: 1 } })

    const firstWindowStart = 0
    const secondWindowStart = PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS * 1000

    await enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient, firstWindowStart)
    await enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient, secondWindowStart)

    const calls = ddbMock.commandCalls(UpdateCommand)
    expect(calls[0].args[0].input.Key).not.toEqual(calls[1].args[0].input.Key)
  })

  it('rejects expensive requests when the rate-limit store is unavailable', async () => {
    const notFound = new Error('Requested resource not found')
    notFound.name = 'ResourceNotFoundException'
    ddbMock.on(UpdateCommand).rejects(notFound)

    await expect(
      enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient),
    ).rejects.toThrow('Place lookups are temporarily unavailable')
  })

  it('scopes the limit per user, not globally', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: 1 } })

    await enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient, 0)
    await enforcePlaceRequestRateLimit('user-2', ddbMock as unknown as DynamoDBDocumentClient, 0)

    const calls = ddbMock.commandCalls(UpdateCommand)
    expect(calls[0].args[0].input.Key).toEqual({ userId: 'user-1', window: '0' })
    expect(calls[1].args[0].input.Key).toEqual({ userId: 'user-2', window: '0' })
  })
})

it.each([undefined, 0, -1, '1', NaN])('rejects an invalid rate-limit counter (%s)', async (requestCount) => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount } })
  await expect(enforcePlaceRequestRateLimit('user-1', ddbMock as unknown as DynamoDBDocumentClient)).rejects.toThrow('Place lookups are temporarily unavailable')
})
