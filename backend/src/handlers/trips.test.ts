import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { UnauthorizedError } from '../lib/errors.js'

vi.mock('../lib/auth.js', () => ({
  getAuthenticatedUserId: vi.fn(),
}))

import { getAuthenticatedUserId } from '../lib/auth.js'
import { handler } from './trips.js'

const ddbMock = mockClient(DynamoDBDocumentClient)
const authMock = vi.mocked(getAuthenticatedUserId)

beforeEach(() => {
  ddbMock.reset()
  authMock.mockReset()
  authMock.mockResolvedValue('user-1')
})

const validTripBody = {
  name: 'Kyoto in spring',
  destination: 'Kyoto, Japan',
  startDate: '2027-04-21',
  endDate: '2027-04-24',
}

describe('authentication', () => {
  it('returns 401 when the bearer token is missing or invalid', async () => {
    authMock.mockRejectedValueOnce(new UnauthorizedError('Missing bearer token'))

    const result = await handler({ httpMethod: 'GET', path: '/trips' })

    expect(result.statusCode).toBe(401)
  })
})

describe('POST /trips', () => {
  it('creates a trip owned by the authenticated user and returns 201', async () => {
    ddbMock.on(PutCommand).resolves({})

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips',
      body: JSON.stringify({ ...validTripBody, userId: 'someone-else' }),
    })

    expect(result.statusCode).toBe(201)
    const trip = JSON.parse(result.body)
    expect(trip.tripId).toBeTruthy()
    expect(trip.name).toBe('Kyoto in spring')
    // userId always comes from the verified token, never the request body.
    expect(trip.userId).toBe('user-1')
  })

  it('returns 400 for invalid input', async () => {
    const result = await handler({
      httpMethod: 'POST',
      path: '/trips',
      body: JSON.stringify({}),
    })

    expect(result.statusCode).toBe(400)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('returns 400 with a clear message when the body is not a JSON object', async () => {
    const result = await handler({
      httpMethod: 'POST',
      path: '/trips',
      body: 'not json',
    })

    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body).message).toBe('Request body must be valid JSON')
  })

  it('returns 500 with a generic message, not the raw AWS error, when DynamoDB fails unexpectedly', async () => {
    ddbMock.on(PutCommand).rejects(new Error('ResourceNotFoundException: table not found'))

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips',
      body: JSON.stringify(validTripBody),
    })

    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body).message).toBe('Internal server error')
    expect(JSON.parse(result.body).message).not.toContain('ResourceNotFoundException')
  })
})

describe('GET /trips', () => {
  it("returns 200 with only the authenticated user's trips", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ ...validTripBody, userId: 'user-1', tripId: 'trip-1' }],
    })

    const result = await handler({ httpMethod: 'GET', path: '/trips' })

    expect(result.statusCode).toBe(200)
    const trips = JSON.parse(result.body)
    expect(trips).toEqual([{ ...validTripBody, userId: 'user-1', tripId: 'trip-1' }])
  })
})

describe('GET /trips/{tripId}', () => {
  it('returns 404 when the trip does not exist', async () => {
    ddbMock.on(GetCommand).resolves({})

    const result = await handler({ httpMethod: 'GET', path: '/trips/missing-trip' })

    expect(result.statusCode).toBe(404)
  })

  it('returns 200 with the trip when it exists', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { ...validTripBody, userId: 'user-1', tripId: 'trip-1', createdAt: 'x', updatedAt: 'x' },
    })

    const result = await handler({ httpMethod: 'GET', path: '/trips/trip-1' })

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body).tripId).toBe('trip-1')
  })

  it('returns 404 when the trip belongs to a different user', async () => {
    authMock.mockResolvedValueOnce('someone-else')
    ddbMock.on(GetCommand).resolves({ Item: undefined })

    const result = await handler({ httpMethod: 'GET', path: '/trips/trip-1' })

    expect(result.statusCode).toBe(404)
  })
})

describe('PATCH /trips/{tripId}', () => {
  it('returns 404 when the trip does not exist', async () => {
    const notFound = new Error('conditional check failed')
    notFound.name = 'ConditionalCheckFailedException'
    ddbMock.on(UpdateCommand).rejects(notFound)

    const result = await handler({
      httpMethod: 'PATCH',
      path: '/trips/missing-trip',
      body: JSON.stringify({ name: 'New name' }),
    })

    expect(result.statusCode).toBe(404)
  })

  it('updates the trip and returns 200', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...validTripBody, userId: 'user-1', tripId: 'trip-1', name: 'New name' },
    })

    const result = await handler({
      httpMethod: 'PATCH',
      path: '/trips/trip-1',
      body: JSON.stringify({ name: 'New name' }),
    })

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body).name).toBe('New name')
  })
})

describe('DELETE /trips/{tripId}', () => {
  it('deletes the trip and its stops, returning 200', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1' } })
    ddbMock.on(QueryCommand).resolves({ Items: [{ tripId: 'trip-1', stopId: 'stop-1' }] })
    ddbMock.on(DeleteCommand).resolves({})

    const result = await handler({ httpMethod: 'DELETE', path: '/trips/trip-1' })

    expect(result.statusCode).toBe(200)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(2)
  })

  it('returns 404 and deletes nothing when the trip does not belong to the authenticated user', async () => {
    authMock.mockResolvedValueOnce('wrong-user')
    ddbMock.on(GetCommand).resolves({ Item: undefined })

    const result = await handler({ httpMethod: 'DELETE', path: '/trips/trip-1' })

    expect(result.statusCode).toBe(404)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })
})

describe('unknown routes', () => {
  it('returns 404', async () => {
    const result = await handler({ httpMethod: 'PUT', path: '/trips/trip-1' })
    expect(result.statusCode).toBe(404)
  })
})
