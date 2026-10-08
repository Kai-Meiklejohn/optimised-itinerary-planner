import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { deleteTrip } from './deleteTrip.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('deleteTrip', () => {
  it('deletes every stop for the trip before deleting the trip itself', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })
    ddbMock.on(UpdateCommand).resolves({})
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { tripId: 'trip-1', stopId: 'stop-1' },
        { tripId: 'trip-1', stopId: 'stop-2' },
      ],
    })
    ddbMock.on(DeleteCommand).resolves({})

    const deleted = await deleteTrip('user-1', 'trip-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(deleted).toBe(true)
    const deleteCalls = ddbMock.commandCalls(DeleteCommand)
    expect(deleteCalls).toHaveLength(3)
    expect(deleteCalls[0].args[0].input.Key).toEqual({ tripId: 'trip-1', stopId: 'stop-1' })
    expect(deleteCalls[1].args[0].input.Key).toEqual({ tripId: 'trip-1', stopId: 'stop-2' })
    expect(deleteCalls[2].args[0].input.Key).toEqual({ userId: 'user-1', tripId: 'trip-1' })
  })

  it('queries stops with a strongly consistent read, so a stop written just before the deleting flag is never missed and orphaned', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })
    ddbMock.on(UpdateCommand).resolves({})
    ddbMock.on(QueryCommand).resolves({ Items: [] })
    ddbMock.on(DeleteCommand).resolves({})

    await deleteTrip('user-1', 'trip-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ConsistentRead).toBe(true)
  })

  it('deletes just the trip when it has no stops', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })
    ddbMock.on(UpdateCommand).resolves({})
    ddbMock.on(QueryCommand).resolves({ Items: [] })
    ddbMock.on(DeleteCommand).resolves({})

    const deleted = await deleteTrip('user-1', 'trip-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(deleted).toBe(true)
    const deleteCalls = ddbMock.commandCalls(DeleteCommand)
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].args[0].input.Key).toEqual({ userId: 'user-1', tripId: 'trip-1' })
  })

  it('follows pagination so stops on a later page are not left behind', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })
    ddbMock.on(UpdateCommand).resolves({})
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ tripId: 'trip-1', stopId: 'stop-1' }],
        LastEvaluatedKey: { tripId: 'trip-1', stopId: 'stop-1' },
      })
      .resolvesOnce({
        Items: [{ tripId: 'trip-1', stopId: 'stop-2' }],
      })
    ddbMock.on(DeleteCommand).resolves({})

    await deleteTrip('user-1', 'trip-1', ddbMock as unknown as DynamoDBDocumentClient)

    const deleteCalls = ddbMock.commandCalls(DeleteCommand)
    expect(deleteCalls).toHaveLength(3)
    expect(deleteCalls[0].args[0].input.Key).toEqual({ tripId: 'trip-1', stopId: 'stop-1' })
    expect(deleteCalls[1].args[0].input.Key).toEqual({ tripId: 'trip-1', stopId: 'stop-2' })
    expect(deleteCalls[2].args[0].input.Key).toEqual({ userId: 'user-1', tripId: 'trip-1' })
  })

  it('marks the trip as deleting before scanning for its stops, so a stop create that starts mid-delete gets rejected', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })
    ddbMock.on(UpdateCommand).resolves({})
    ddbMock.on(QueryCommand).resolves({ Items: [{ tripId: 'trip-1', stopId: 'stop-1' }] })
    ddbMock.on(DeleteCommand).resolves({})

    await deleteTrip('user-1', 'trip-1', ddbMock as unknown as DynamoDBDocumentClient)

    const updateCall = ddbMock.commandCalls(UpdateCommand)[0].args[0].input
    expect(updateCall.Key).toEqual({ userId: 'user-1', tripId: 'trip-1' })
    expect(updateCall.UpdateExpression).toBe('SET deleting = :true')

    const allCalls = ddbMock.calls()
    const updateIndex = allCalls.findIndex((call) => call.args[0] instanceof UpdateCommand)
    const queryIndex = allCalls.findIndex((call) => call.args[0] instanceof QueryCommand)
    expect(updateIndex).toBeLessThan(queryIndex)
  })

  it('returns false without touching any stops when the trip vanishes between the ownership check and the deleting flag', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })
    const notFound = new Error('conditional check failed')
    notFound.name = 'ConditionalCheckFailedException'
    ddbMock.on(UpdateCommand).rejects(notFound)

    const deleted = await deleteTrip('user-1', 'trip-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(deleted).toBe(false)
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })

  it('does not delete any stops when the trip does not belong to the given user', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined })

    const deleted = await deleteTrip('wrong-user', 'trip-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(deleted).toBe(false)
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })
})
