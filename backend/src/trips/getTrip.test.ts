import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { getTrip } from './getTrip.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('getTrip', () => {
  it('returns the trip item when it exists', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        userId: 'user-1',
        tripId: 'trip-1',
        name: 'Kyoto in spring',
        destination: 'Kyoto, Japan',
        startDate: '2027-04-21',
        endDate: '2027-04-24',
        createdAt: '2026-08-14T00:00:00Z',
        updatedAt: '2026-08-14T00:00:00Z',
      },
    })

    const trip = await getTrip(
      { userId: 'user-1', tripId: 'trip-1' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(trip?.name).toBe('Kyoto in spring')
    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({
      userId: 'user-1',
      tripId: 'trip-1',
    })
  })

  it('uses a strongly consistent read, so a trip just created is never falsely reported missing', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })

    await getTrip({ userId: 'user-1', tripId: 'trip-1' }, ddbMock as unknown as DynamoDBDocumentClient)

    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.ConsistentRead).toBe(true)
  })

  it('returns undefined when the trip does not exist', async () => {
    ddbMock.on(GetCommand).resolves({})

    const trip = await getTrip(
      { userId: 'user-1', tripId: 'missing-trip' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(trip).toBeUndefined()
  })
})
