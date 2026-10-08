import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { listTrips } from './listTrips.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('listTrips', () => {
  it('queries by the partition key so only that user\'s trips are returned', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'user-1', tripId: 'trip-1', name: 'Kyoto in spring' }],
    })

    const trips = await listTrips('user-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(trips).toEqual([{ userId: 'user-1', tripId: 'trip-1', name: 'Kyoto in spring' }])
    const call = ddbMock.commandCalls(QueryCommand)[0].args[0].input
    expect(call.KeyConditionExpression).toBe('userId = :userId')
    expect(call.ExpressionAttributeValues).toEqual({ ':userId': 'user-1' })
  })

  it('reads with strong consistency so a just-created trip is never missing from this same list', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await listTrips('user-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ConsistentRead).toBe(true)
  })

  it('sorts trips by most recently updated first', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-1', tripId: 'trip-1', updatedAt: '2027-01-01T00:00:00.000Z' },
        { userId: 'user-1', tripId: 'trip-2', updatedAt: '2027-03-01T00:00:00.000Z' },
        { userId: 'user-1', tripId: 'trip-3', updatedAt: '2027-02-01T00:00:00.000Z' },
      ],
    })

    const trips = await listTrips('user-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(trips.map((trip) => trip.tripId)).toEqual(['trip-2', 'trip-3', 'trip-1'])
  })

  it('returns an empty array when the user has no trips', async () => {
    ddbMock.on(QueryCommand).resolves({})

    const trips = await listTrips('user-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(trips).toEqual([])
  })

  it('follows pagination to collect trips across multiple pages', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ userId: 'user-1', tripId: 'trip-1' }],
        LastEvaluatedKey: { userId: 'user-1', tripId: 'trip-1' },
      })
      .resolvesOnce({
        Items: [{ userId: 'user-1', tripId: 'trip-2' }],
      })

    const trips = await listTrips('user-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(trips.map((trip) => trip.tripId)).toEqual(['trip-1', 'trip-2'])
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2)
  })
})
