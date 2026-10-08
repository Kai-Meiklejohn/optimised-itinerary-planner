import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { listStops } from './listStops.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('listStops', () => {
  it('sorts stops by date, then by order within the same date', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { tripId: 't1', stopId: 'c', date: '2027-04-21', order: 2000 },
        { tripId: 't1', stopId: 'a', date: '2027-04-21', order: 1000 },
        { tripId: 't1', stopId: 'b', date: '2027-04-20', order: 1000 },
      ],
    })

    const stops = await listStops('t1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(stops.map((s) => s.stopId)).toEqual(['b', 'a', 'c'])
  })

  it('reads with strong consistency so a just-added stop is never missing from this same list', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await listStops('t1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ConsistentRead).toBe(true)
  })

  it('sorts undated stops after every dated one', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { tripId: 't1', stopId: 'undated', order: 1000 },
        { tripId: 't1', stopId: 'dated', date: '2027-04-21', order: 5000 },
      ],
    })

    const stops = await listStops('t1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(stops.map((s) => s.stopId)).toEqual(['dated', 'undated'])
  })

  it('returns an empty array when the trip has no stops', async () => {
    ddbMock.on(QueryCommand).resolves({})

    const stops = await listStops('t1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(stops).toEqual([])
  })

  it('excludes internal order-counter rows from the result', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { tripId: 't1', stopId: '#order#2027-04-21', orderCounter: 2 },
        { tripId: 't1', stopId: 'a', date: '2027-04-21', order: 1000 },
      ],
    })

    const stops = await listStops('t1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(stops.map((s) => s.stopId)).toEqual(['a'])
  })

  it('follows pagination to collect stops across multiple pages', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ tripId: 't1', stopId: 'a', date: '2027-04-21', order: 1000 }],
        LastEvaluatedKey: { tripId: 't1', stopId: 'a' },
      })
      .resolvesOnce({
        Items: [{ tripId: 't1', stopId: 'b', date: '2027-04-21', order: 2000 }],
      })

    const stops = await listStops('t1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(stops.map((s) => s.stopId)).toEqual(['a', 'b'])
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2)
  })
})
