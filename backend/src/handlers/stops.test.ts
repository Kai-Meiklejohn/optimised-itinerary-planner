import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, TransactWriteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { GeoPlacesClient, GeocodeCommand, GetPlaceCommand, SuggestCommand } from '@aws-sdk/client-geo-places'
import { UnauthorizedError } from '../lib/errors.js'

vi.mock('../lib/auth.js', () => ({
  getAuthenticatedUserId: vi.fn(),
}))

import { getAuthenticatedUserId } from '../lib/auth.js'
import { handler } from './stops.js'

const ddbMock = mockClient(DynamoDBDocumentClient)
const placesMock = mockClient(GeoPlacesClient)
const authMock = vi.mocked(getAuthenticatedUserId)

const ownedTrip = { userId: 'user-1', tripId: 'trip-1' }

beforeEach(() => {
  ddbMock.reset()
  ddbMock.on(QueryCommand).resolves({ Items: [{ tripId: 'trip-1', stopId: 'stop-1', date: '2027-04-21', time: '08:00', visitDurationMinutes: 60 }] })
  ddbMock.on(TransactWriteCommand).resolves({})
  placesMock.reset()
  authMock.mockReset()
  authMock.mockResolvedValue('user-1')
  ddbMock.on(GetCommand).resolves({ Item: ownedTrip })
  // Default for both the order counter (getNextOrder) and the place-request
  // rate limiter, which both use a plain UpdateCommand against different keys -
  // individual tests override this where the specific count matters.
  ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1, requestCount: 1 } })
})

describe('POST /trips/{tripId}/stops', () => {
  it('creates a stop and returns 201', async () => {
    placesMock.on(GetPlaceCommand).resolves({
      PlaceId: 'place-123',
      PlaceType: 'PointOfInterest',
      Title: 'Fushimi Inari Taisha',
      PricingBucket: 'Core',
      Position: [135.7727, 34.9671],
      Categories: [{ Id: 'c1', Name: 'Shrine' }],
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1, requestCount: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        placeId: 'place-123',
        visitDurationMinutes: 90,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(201)
    const stop = JSON.parse(result.body)
    expect(stop.tripId).toBe('trip-1')
    expect(stop.placeName).toBe('Fushimi Inari Taisha')
    expect(stop.order).toBe(1000)
  })

  it('returns 400 for invalid input', async () => {
    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({ placeId: 'place-123' }),
    })

    expect(result.statusCode).toBe(400)
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('returns 400 with a clear message for a stale or invalid placeId, not a 500', async () => {
    const notFound = new Error('Place not found')
    notFound.name = 'ResourceNotFoundException'
    placesMock.on(GetPlaceCommand).rejects(notFound)

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({ placeId: 'stale-place-id', visitDurationMinutes: 60, priority: 1 }),
    })

    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body).message).toBe('Could not find a place matching placeId "stale-place-id"')
  })

  it('returns 500 with a generic message, not the raw AWS error, when DynamoDB fails unexpectedly', async () => {
    placesMock.on(GetPlaceCommand).resolves({ PlaceId: 'place-123', Title: 'Fushimi Inari Taisha' })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1, requestCount: 1 } })
    ddbMock.on(TransactWriteCommand).rejects(new Error('ProvisionedThroughputExceededException: throttled'))

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({ placeId: 'place-123', visitDurationMinutes: 60, priority: 2 }),
    })

    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body).message).toBe('Internal server error')
  })

  it('resolves a place by name only when the frontend reports a live search selection', async () => {
    placesMock.on(GeocodeCommand).resolves({
      ResultItems: [{ PlaceId: 'dest-1', PlaceType: 'Locality', Title: 'Kyoto', Position: [135.7681, 35.0116] }],
    })
    placesMock.on(SuggestCommand).resolves({
      ResultItems: [
        { Title: 'Fushimi Inari Taisha', SuggestResultItemType: 'Place', Place: { PlaceId: 'place-123' } },
      ],
    })
    placesMock.on(GetPlaceCommand).resolves({
      PlaceId: 'place-123',
      PlaceType: 'PointOfInterest',
      Title: 'Fushimi Inari Taisha',
      Position: [135.7727, 34.9671],
      Categories: [{ Id: 'cat-1', Name: 'Shrine' }],
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1, requestCount: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'Fushimi Inari',
        destination: 'Kyoto, Japan',
        placeSelected: true,
        visitDurationMinutes: 90,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(201)
    expect(JSON.parse(result.body).placeName).toBe('Fushimi Inari Taisha')
  })

  it('does not run a name-based place search for a manually typed entry, and geocodes the given address instead', async () => {
    placesMock.on(GeocodeCommand).resolves({
      ResultItems: [{ PlaceId: 'addr-1', PlaceType: 'PointAddress', Title: '123 Queen Street', Position: [174.7633, -36.8485] }],
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1, requestCount: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'the house',
        destination: 'Auckland, New Zealand',
        address: '123 Queen Street, Auckland',
        notes: 'Ring the doorbell twice.',
        placeSelected: false,
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(201)
    const stop = JSON.parse(result.body)
    expect(stop.placeName).toBe('the house')
    expect(stop.location).toEqual({ lat: -36.8485, lng: 174.7633 })
    expect(stop.address).toBe('123 Queen Street, Auckland')
    expect(stop.notes).toBe('Ring the doorbell twice.')
    expect(placesMock.commandCalls(SuggestCommand)).toHaveLength(0)
    expect(placesMock.commandCalls(GetPlaceCommand)).toHaveLength(0)
  })

  it('creates a manual stop with no location when no address is given', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1, requestCount: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'the house',
        destination: 'Auckland, New Zealand',
        placeSelected: false,
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(201)
    const stop = JSON.parse(result.body)
    expect(stop.placeName).toBe('the house')
    expect(stop.location).toBeUndefined()
    expect(placesMock.commandCalls(GeocodeCommand)).toHaveLength(0)
  })

  it('returns 429 and never reaches the place lookup once the per-user rate limit is exceeded', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: 21 } })

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'the house',
        destination: 'Auckland, New Zealand',
        placeSelected: true,
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(429)
    expect(placesMock.commandCalls(SuggestCommand)).toHaveLength(0)
  })

  it('rejects an oversized place name before making any billable AWS Location call', async () => {
    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'a'.repeat(201),
        destination: 'Auckland, New Zealand',
        placeSelected: true,
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(400)
    expect(placesMock.commandCalls(SuggestCommand)).toHaveLength(0)
    expect(placesMock.commandCalls(GeocodeCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('rejects an oversized manually entered address before geocoding it', async () => {
    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'the house',
        destination: 'Auckland, New Zealand',
        address: 'a'.repeat(301),
        placeSelected: false,
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(400)
    expect(placesMock.commandCalls(GeocodeCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('returns a 500, not a silently unmapped stop, when geocoding fails for a reason other than "not found"', async () => {
    const throttled = new Error('Rate exceeded')
    throttled.name = 'ThrottlingException'
    placesMock.on(GeocodeCommand).rejects(throttled)

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'the house',
        destination: 'Auckland, New Zealand',
        address: '123 Queen Street, Auckland',
        placeSelected: false,
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-21',
      }),
    })

    expect(result.statusCode).toBe(500)
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('rejects a stop date outside the trip\'s own start/end date range', async () => {
    ddbMock.reset()
  ddbMock.on(QueryCommand).resolves({ Items: [{ tripId: 'trip-1', stopId: 'stop-1', date: '2027-04-21', time: '08:00', visitDurationMinutes: 60 }] })
  ddbMock.on(TransactWriteCommand).resolves({})
    ddbMock.on(GetCommand).resolves({ Item: { userId: 'user-1', tripId: 'trip-1', startDate: '2027-04-21', endDate: '2027-04-24' } })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: 1 } })

    const result = await handler({
      httpMethod: 'POST',
      path: '/trips/trip-1/stops',
      body: JSON.stringify({
        query: 'the house',
        destination: 'Auckland, New Zealand',
        placeSelected: false,
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-05-01',
      }),
    })

    expect(result.statusCode).toBe(400)
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('returns 404 for an unmatched route', async () => {
    const result = await handler({
      httpMethod: 'DELETE',
      path: '/trips/trip-1/stops',
    })
    expect(result.statusCode).toBe(404)
  })

  it('returns 400, not 500, for a malformed percent-encoded tripId', async () => {
    const result = await handler({
      httpMethod: 'GET',
      path: '/trips/%/stops',
    })

    expect(result.statusCode).toBe(400)
  })
})

describe('stop ownership', () => {
  it('returns 401 when the bearer token is missing or invalid', async () => {
    authMock.mockReset()
    authMock.mockRejectedValueOnce(new UnauthorizedError('Missing bearer token'))

    const result = await handler({ httpMethod: 'GET', path: '/trips/trip-1/stops' })

    expect(result.statusCode).toBe(401)
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
  })

  it('returns 404 and never touches stops when the trip does not belong to the authenticated user', async () => {
    authMock.mockResolvedValueOnce('someone-else')
    ddbMock.reset()
  ddbMock.on(QueryCommand).resolves({ Items: [{ tripId: 'trip-1', stopId: 'stop-1', date: '2027-04-21', time: '08:00', visitDurationMinutes: 60 }] })
  ddbMock.on(TransactWriteCommand).resolves({})
    ddbMock.on(GetCommand).resolves({ Item: undefined })

    const result = await handler({
      httpMethod: 'DELETE',
      path: '/trips/trip-1/stops/stop-1',
    })

    expect(result.statusCode).toBe(404)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })
})

describe('GET /trips/{tripId}/stops', () => {
  it('returns the trip\'s stops sorted by date and order', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { tripId: 'trip-1', stopId: 's2', date: '2027-04-21', order: 2000 },
        { tripId: 'trip-1', stopId: 's1', date: '2027-04-21', order: 1000 },
      ],
    })

    const result = await handler({ httpMethod: 'GET', path: '/trips/trip-1/stops' })

    expect(result.statusCode).toBe(200)
    const stops = JSON.parse(result.body)
    expect(stops.map((s: { stopId: string }) => s.stopId)).toEqual(['s1', 's2'])
  })

  it('returns an empty array when the trip has no stops', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    const result = await handler({ httpMethod: 'GET', path: '/trips/trip-1/stops' })

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual([])
  })
})

describe('PATCH /trips/{tripId}/stops/{stopId}', () => {
  it('updates the stop\'s time and returns 200', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { tripId: 'trip-1', stopId: 'stop-1', time: '09:30' },
    })

    const result = await handler({
      httpMethod: 'PATCH',
      path: '/trips/trip-1/stops/stop-1',
      body: JSON.stringify({ time: '09:30' }),
    })

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body).time).toBe('09:30')
  })

  it('returns 404 when the stop does not exist', async () => {
    const notFound = new Error('conditional check failed')
    notFound.name = 'ConditionalCheckFailedException'
    ddbMock.on(UpdateCommand).rejects(notFound)

    const result = await handler({
      httpMethod: 'PATCH',
      path: '/trips/trip-1/stops/missing-stop',
      body: JSON.stringify({ time: '09:30' }),
    })

    expect(result.statusCode).toBe(404)
  })

  it('returns 400 for invalid input', async () => {
    const result = await handler({
      httpMethod: 'PATCH',
      path: '/trips/trip-1/stops/stop-1',
      body: JSON.stringify({ time: 'not-a-time' }),
    })

    expect(result.statusCode).toBe(400)
  })

  it('returns 404 and never touches DynamoDB for the internal order-counter row', async () => {
    const result = await handler({
      httpMethod: 'PATCH',
      path: '/trips/trip-1/stops/%23order%232027-04-21',
      body: JSON.stringify({ time: '09:30' }),
    })

    expect(result.statusCode).toBe(404)
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('rejects an oversized stopId path segment before it reaches DynamoDB', async () => {
    const result = await handler({
      httpMethod: 'PATCH',
      path: `/trips/trip-1/stops/${'x'.repeat(101)}`,
      body: JSON.stringify({ time: '09:30' }),
    })

    expect(result.statusCode).toBe(400)
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })
})

describe('DELETE /trips/{tripId}/stops/{stopId}', () => {
  it('deletes the stop and returns 200', async () => {
    ddbMock.on(DeleteCommand).resolves({})

    const result = await handler({
      httpMethod: 'DELETE',
      path: '/trips/trip-1/stops/stop-1',
    })

    expect(result.statusCode).toBe(200)
    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({
      tripId: 'trip-1',
      stopId: 'stop-1',
    })
  })

  it('rejects an oversized stopId path segment before it reaches DynamoDB', async () => {
    const result = await handler({
      httpMethod: 'DELETE',
      path: `/trips/trip-1/stops/${'x'.repeat(101)}`,
    })

    expect(result.statusCode).toBe(400)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })
})

describe('POST /trips/{tripId}/stops/resolve', () => {
  const event = { httpMethod: 'POST', path: '/trips/trip-1/stops/resolve', body: JSON.stringify({ query: 'Tokyo Sky Tree', destination: 'Tokyo, Japan' }) }

  it('returns authoritative English details and a suggested category without creating a stop', async () => {
    placesMock.on(GeocodeCommand).resolves({ ResultItems: [{ PlaceId: 'tokyo', PlaceType: 'Locality', Title: 'Tokyo', Position: [139.8, 35.7] }] })
    placesMock.on(SuggestCommand).resolves({ ResultItems: [{ Title: 'Tokyo Skytree', SuggestResultItemType: 'Place', Place: { PlaceId: 'tower' } }] })
    placesMock.on(GetPlaceCommand).resolves({ PlaceId: 'tower', Title: 'Tokyo Skytree', Categories: [{ Id: 'restaurant', Name: 'Restaurant' }], Position: [139.81, 35.71] })
    const response = await handler(event)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ placeId: 'tower', name: 'Tokyo Skytree', category: 'Food', location: { lat: 35.71, lng: 139.81 } })
    expect(placesMock.commandCalls(GetPlaceCommand)[0].args[0].input.Language).toBe('en')
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('checks ownership before resolving a place', async () => {
    ddbMock.on(GetCommand).resolves({})
    expect((await handler(event)).statusCode).toBe(404)
    expect(placesMock.calls()).toHaveLength(0)
  })

  it.each([{}, { query: ' ', destination: 'Tokyo' }, { query: 'Tower', destination: [] }, { query: 'x'.repeat(201), destination: 'Tokyo' }])('rejects invalid lookup input %j before calling AWS', async (input) => {
    expect((await handler({ ...event, body: JSON.stringify(input) })).statusCode).toBe(400)
    expect(placesMock.calls()).toHaveLength(0)
  })
})

it('rate limits selected-place previews before calling Places', async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: 999 } })
  const result = await handler({ httpMethod: 'POST', path: '/trips/trip-1/stops/resolve', body: JSON.stringify({ query: 'Seoul Station', destination: 'Seoul' }) })
  expect(result.statusCode).toBe(429)
  expect(placesMock.calls()).toHaveLength(0)
})

it('rate limits place replacements but does not charge ordinary category edits to the place quota', async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: { requestCount: 999 } })
  const event = { httpMethod: 'PATCH', path: '/trips/trip-1/stops/stop-1' }
  expect((await handler({ ...event, body: JSON.stringify({ placeId: 'p', category: 'Food' }) })).statusCode).toBe(429)
  expect(placesMock.calls()).toHaveLength(0)
  expect((await handler({ ...event, body: JSON.stringify({ address: 'Paris' }) })).statusCode).toBe(429)
  expect((await handler({ ...event, body: JSON.stringify({ address: '' }) })).statusCode).toBe(200)
  expect((await handler({ ...event, body: JSON.stringify({ category: 'Food' }) })).statusCode).toBe(200)
})

it.each(['POST', 'PATCH'])('returns a validation response for overlapping %s schedules', async (method) => {
  ddbMock.on(QueryCommand).resolves({ Items: [
    { stopId: 'stop-1', date: '2027-04-21', time: '08:00', visitDurationMinutes: 60 },
    { stopId: 'stop-2', date: '2027-04-21', time: '10:00', visitDurationMinutes: 60, placeName: 'Museum' },
  ] })
  const response = await handler({ httpMethod: method, path: `/trips/trip-1/stops${method === 'PATCH' ? '/stop-1' : ''}`,
    body: JSON.stringify({ query: 'Cafe', time: '10:30', date: '2027-04-21', visitDurationMinutes: 60, priority: 3 }) })
  expect(response.statusCode).toBe(400)
  expect(JSON.parse(response.body).message).toContain('overlaps with Museum')
  expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
})

it('returns 503 without billing Places or saving a stop when rate limiting is unavailable', async () => {
  ddbMock.on(UpdateCommand).rejects(new Error('Counter unavailable'))
  const result = await handler({ httpMethod: 'POST', path: '/trips/trip-1/stops/resolve', body: JSON.stringify({ query: 'Tokyo Skytree', destination: 'Tokyo' }) })
  expect(result.statusCode).toBe(503)
  expect(placesMock.calls()).toHaveLength(0)
  expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
})
