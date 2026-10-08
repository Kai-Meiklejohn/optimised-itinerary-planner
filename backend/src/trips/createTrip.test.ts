import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { createTrip } from './createTrip.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('createTrip', () => {
  it('writes a trip with a generated tripId and matching timestamps', async () => {
    ddbMock.on(PutCommand).resolves({})

    const trip = await createTrip(
      {
        userId: 'user-1',
        name: 'Kyoto in spring',
        destination: 'Kyoto, Japan',
        startDate: '2027-04-21',
        endDate: '2027-04-24',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(trip.tripId).toBeTruthy()
    expect(trip.createdAt).toBe(trip.updatedAt)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1)
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.TableName).toBe('Trip')
  })

  it('rejects input missing required fields', async () => {
    await expect(
      createTrip({ userId: 'user-1', name: '' }, ddbMock as unknown as DynamoDBDocumentClient),
    ).rejects.toThrow('Invalid trip input')

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('rejects a whitespace-only name or destination', async () => {
    await expect(
      createTrip(
        { userId: 'user-1', name: '   ', destination: 'Kyoto, Japan', startDate: '2027-04-21', endDate: '2027-04-24' },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid trip input')

    await expect(
      createTrip(
        { userId: 'user-1', name: 'Kyoto in spring', destination: '   ', startDate: '2027-04-21', endDate: '2027-04-24' },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid trip input')

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('trims surrounding whitespace from the name and destination before storing', async () => {
    ddbMock.on(PutCommand).resolves({})

    const trip = await createTrip(
      {
        userId: 'user-1',
        name: '  Kyoto in spring  ',
        destination: '  Kyoto, Japan  ',
        startDate: '2027-04-21',
        endDate: '2027-04-24',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(trip.name).toBe('Kyoto in spring')
    expect(trip.destination).toBe('Kyoto, Japan')
  })

  it('rejects a name or destination that exceeds the length limit', async () => {
    await expect(
      createTrip(
        {
          userId: 'user-1',
          name: 'a'.repeat(201),
          destination: 'Kyoto, Japan',
          startDate: '2027-04-21',
          endDate: '2027-04-24',
        },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid trip input')

    await expect(
      createTrip(
        {
          userId: 'user-1',
          name: 'Kyoto in spring',
          destination: 'a'.repeat(201),
          startDate: '2027-04-21',
          endDate: '2027-04-24',
        },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid trip input')

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('rejects a trip where endDate is before startDate', async () => {
    await expect(
      createTrip(
        {
          userId: 'user-1',
          name: 'Kyoto in spring',
          destination: 'Kyoto, Japan',
          startDate: '2027-04-24',
          endDate: '2027-04-21',
        },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid trip input')
  })

  it('rejects a syntactically valid but impossible calendar date', async () => {
    await expect(
      createTrip(
        {
          userId: 'user-1',
          name: 'Kyoto in spring',
          destination: 'Kyoto, Japan',
          startDate: '2027-02-30',
          endDate: '2027-03-01',
        },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid trip input')

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })
})

const validTrip = { userId: 'user-1', name: 'Trip', destination: 'Tokyo', startDate: '2028-01-01', endDate: '2028-02-29' }

it('accepts exactly 60 days including a leap day', async () => {
  ddbMock.on(PutCommand).resolves({})
  await expect(createTrip(validTrip, ddbMock as unknown as DynamoDBDocumentClient)).resolves.toMatchObject(validTrip)
})

it.each(['2028-03-01', '9999-12-31'])('rejects a creation longer than 60 days (%s) before writing', async (endDate) => {
  await expect(createTrip({ ...validTrip, endDate }, ddbMock as unknown as DynamoDBDocumentClient)).rejects.toThrow('Invalid trip input')
  expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
})

it('only stores allowed trip fields and generates its own metadata', async () => {
  ddbMock.on(PutCommand).resolves({})
  const input = { ...validTrip, deleting: true, scheduleRevision: -1, unknown: 'payload', tripId: 'chosen', createdAt: 'chosen' }
  const trip = await createTrip(input, ddbMock as unknown as DynamoDBDocumentClient)
  expect(trip).not.toHaveProperty('deleting')
  expect(trip).not.toHaveProperty('scheduleRevision')
  expect(trip).not.toHaveProperty('unknown')
  expect(trip.tripId).not.toBe('chosen')
  expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toEqual(trip)
})
