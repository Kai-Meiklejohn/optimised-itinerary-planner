import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { updateTrip, validateUpdateTripInput } from './updateTrip.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('validateUpdateTripInput', () => {
  it('rejects an empty update', () => {
    expect(validateUpdateTripInput({})).toBe(false)
  })

  it('rejects a blank name', () => {
    expect(validateUpdateTripInput({ name: '' })).toBe(false)
  })

  it('rejects a whitespace-only name or destination', () => {
    expect(validateUpdateTripInput({ name: '   ' })).toBe(false)
    expect(validateUpdateTripInput({ destination: '   ' })).toBe(false)
  })

  it('accepts one-day, leap-day and maximum-length ranges but rejects day 61', () => {
    expect(validateUpdateTripInput({ startDate: '2028-02-29', endDate: '2028-02-29' })).toBe(true)
    expect(validateUpdateTripInput({ startDate: '2027-01-01', endDate: '2027-03-01' })).toBe(true)
    expect(validateUpdateTripInput({ startDate: '2027-01-01', endDate: '2027-03-02' })).toBe(false)
    expect(validateUpdateTripInput({ startDate: null, endDate: 12 } as never)).toBe(false)
  })

  it('accepts a name-only update', () => {
    expect(validateUpdateTripInput({ name: 'New name' })).toBe(true)
  })

  it('rejects a name or destination that exceeds the length limit', () => {
    expect(validateUpdateTripInput({ name: 'a'.repeat(201) })).toBe(false)
    expect(validateUpdateTripInput({ destination: 'a'.repeat(201) })).toBe(false)
  })
})

describe('updateTrip', () => {
  it('updates dates after checking ownership and saved stops', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { tripId: 'trip-1' } })
    ddbMock.on(QueryCommand).resolves({ Items: [{ stopId: 'stop-1', date: '2027-05-02', order: 1 }] })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { endDate: '2027-05-03' } })
    expect((await updateTrip('user-1', 'trip-1', { startDate: '2027-05-01', endDate: '2027-05-03' }))?.endDate).toBe('2027-05-03')
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1)
    expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues).toMatchObject({ ':startDate': '2027-05-01', ':endDate': '2027-05-03' })
  })

  it('rejects shortening across saved stops on later query pages', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { tripId: 'trip-1' } })
    ddbMock.on(QueryCommand).resolvesOnce({ Items: [], LastEvaluatedKey: { tripId: 'trip-1', stopId: 'page' } }).resolves({ Items: [{ stopId: 'stop-1', date: '2027-05-01', order: 1 }] })
    await expect(updateTrip('user-1', 'trip-1', { startDate: '2027-05-02', endDate: '2027-05-03' })).rejects.toThrow(/Remove the places/)
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('does not read stops or write for a trip the caller does not own', async () => {
    ddbMock.on(GetCommand).resolves({})
    expect(await updateTrip('other-user', 'trip-1', { startDate: '2027-05-01', endDate: '2027-05-03' })).toBeUndefined()
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it.each([
    { startDate: '2027-05-01' },
    { startDate: '2027-02-30', endDate: '2027-03-01' },
    { startDate: '2027-05-03', endDate: '2027-05-01' },
    { startDate: '2027-01-01', endDate: '2027-12-31' },
  ])('rejects invalid date updates %j without writes', async (input) => {
    await expect(updateTrip('user-1', 'trip-1', input)).rejects.toThrow('Invalid trip update input')
    expect(ddbMock.calls()).toHaveLength(0)
  })

  it('updates the name and destination and returns the new trip', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        tripId: 'trip-1',
        userId: 'user-1',
        name: 'New name',
        destination: 'New destination',
      },
    })

    const trip = await updateTrip(
      'user-1',
      'trip-1',
      { name: 'New name', destination: 'New destination' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(trip?.name).toBe('New name')
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input
    expect(call.Key).toEqual({ userId: 'user-1', tripId: 'trip-1' })
    expect(call.ExpressionAttributeValues).toMatchObject({
      ':name': 'New name',
      ':destination': 'New destination',
    })
  })

  it('trims surrounding whitespace from the name and destination before storing', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: {} })

    await updateTrip(
      'user-1',
      'trip-1',
      { name: '  New name  ', destination: '  New destination  ' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input
    expect(call.ExpressionAttributeValues).toMatchObject({
      ':name': 'New name',
      ':destination': 'New destination',
    })
  })

  it('rejects invalid input without calling DynamoDB', async () => {
    await expect(
      updateTrip('user-1', 'trip-1', {}, ddbMock as unknown as DynamoDBDocumentClient),
    ).rejects.toThrow('Invalid trip update input')

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('returns undefined when the trip does not exist', async () => {
    const notFound = new Error('conditional check failed')
    notFound.name = 'ConditionalCheckFailedException'
    ddbMock.on(UpdateCommand).rejects(notFound)

    const trip = await updateTrip(
      'user-1',
      'missing-trip',
      { name: 'New name' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(trip).toBeUndefined()
  })
})
