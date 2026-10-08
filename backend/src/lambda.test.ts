import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tripsHandlerMock, stopsHandlerMock, usersHandlerMock } = vi.hoisted(() => ({
  tripsHandlerMock: vi.fn(),
  stopsHandlerMock: vi.fn(),
  usersHandlerMock: vi.fn(),
}))

vi.mock('./handlers/trips.js', () => ({ handler: tripsHandlerMock }))
vi.mock('./handlers/stops.js', () => ({ handler: stopsHandlerMock }))
vi.mock('./handlers/users.js', () => ({ handler: usersHandlerMock }))

const FRONTEND_ORIGIN = 'https://planner.example.test'
vi.stubEnv('FRONTEND_ORIGIN', FRONTEND_ORIGIN)

const { handler } = await import('./lambda.js')

const okResult = { statusCode: 200, statusDescription: '200 OK', headers: { 'Content-Type': 'application/json' }, body: '{}' }

function corsHeadersFor(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    Vary: 'Origin',
  }
}

describe('lambda handler', () => {
  beforeEach(() => {
    tripsHandlerMock.mockReset().mockResolvedValue(okResult)
    stopsHandlerMock.mockReset().mockResolvedValue(okResult)
    usersHandlerMock.mockReset().mockResolvedValue(okResult)
  })

  describe('API Gateway events (rawPath/requestContext.http)', () => {
    it('answers OPTIONS preflight requests directly, without invoking any route handler', async () => {
      const result = await handler({
        rawPath: '/users',
        requestContext: { http: { method: 'OPTIONS' } },
      })

      expect(result).toEqual({ statusCode: 200, headers: {}, body: '', isBase64Encoded: false })
      expect(usersHandlerMock).not.toHaveBeenCalled()
    })

    it('routes /trips/:id/stops requests to the stops handler', async () => {
      await handler({
        rawPath: '/trips/trip-1/stops',
        requestContext: { http: { method: 'GET' } },
      })

      expect(stopsHandlerMock).toHaveBeenCalledTimes(1)
      expect(tripsHandlerMock).not.toHaveBeenCalled()
    })

    it('routes /trips/:id/stops/:stopId requests to the stops handler', async () => {
      await handler({
        rawPath: '/trips/trip-1/stops/stop-1',
        requestContext: { http: { method: 'DELETE' } },
      })

      expect(stopsHandlerMock).toHaveBeenCalledTimes(1)
    })

    it('routes /users requests to the users handler', async () => {
      await handler({
        rawPath: '/users',
        requestContext: { http: { method: 'POST' } },
      })

      expect(usersHandlerMock).toHaveBeenCalledTimes(1)
      expect(tripsHandlerMock).not.toHaveBeenCalled()
    })

    it('routes every other path to the trips handler', async () => {
      await handler({
        rawPath: '/trips/trip-1',
        requestContext: { http: { method: 'GET' } },
      })

      expect(tripsHandlerMock).toHaveBeenCalledTimes(1)
      expect(stopsHandlerMock).not.toHaveBeenCalled()
      expect(usersHandlerMock).not.toHaveBeenCalled()
    })

    it('forwards the API Gateway authorizer claims to the route handler', async () => {
      const authorizer = { jwt: { claims: { sub: 'user-1' } } }

      await handler({
        rawPath: '/trips',
        requestContext: { http: { method: 'GET' }, authorizer },
      })

      const normalizedEvent = tripsHandlerMock.mock.calls[0][0]
      expect(normalizedEvent.requestContext).toEqual({ authorizer })
    })

    it('decodes a base64-encoded body before handing it to the route handler', async () => {
      const decoded = JSON.stringify({ name: 'Kyoto' })

      await handler({
        rawPath: '/trips',
        requestContext: { http: { method: 'POST' } },
        body: Buffer.from(decoded, 'utf-8').toString('base64'),
        isBase64Encoded: true,
      })

      const normalizedEvent = tripsHandlerMock.mock.calls[0][0]
      expect(normalizedEvent.body).toBe(decoded)
    })

    it('passes a non-base64 body through unchanged', async () => {
      const body = JSON.stringify({ name: 'Kyoto' })

      await handler({
        rawPath: '/trips',
        requestContext: { http: { method: 'POST' } },
        body,
        isBase64Encoded: false,
      })

      const normalizedEvent = tripsHandlerMock.mock.calls[0][0]
      expect(normalizedEvent.body).toBe(body)
    })

    it('maps rawPath, method, and query parameters onto the normalized event', async () => {
      await handler({
        rawPath: '/trips',
        queryStringParameters: { userId: 'user-1' },
        headers: { authorization: 'Bearer token' },
        requestContext: { http: { method: 'GET' } },
      })

      const normalizedEvent = tripsHandlerMock.mock.calls[0][0]
      expect(normalizedEvent.httpMethod).toBe('GET')
      expect(normalizedEvent.path).toBe('/trips')
      expect(normalizedEvent.queryStringParameters).toEqual({ userId: 'user-1' })
      expect(normalizedEvent.headers).toEqual({ authorization: 'Bearer token' })
    })

    it('defaults to GET when the event carries no HTTP method', async () => {
      await handler({
        rawPath: '/trips',
        requestContext: {},
      })

      expect(tripsHandlerMock.mock.calls[0][0].httpMethod).toBe('GET')
    })

    it("returns the route handler's status, headers, and body, without CORS headers", async () => {
      tripsHandlerMock.mockResolvedValue({
        statusCode: 201,
        statusDescription: '201 Created',
        headers: { 'Content-Type': 'application/json' },
        body: '{"tripId":"trip-1"}',
      })

      const result = await handler({
        rawPath: '/trips',
        requestContext: { http: { method: 'POST' } },
      })

      expect(result).toEqual({
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: '{"tripId":"trip-1"}',
        isBase64Encoded: false,
      })
    })
  })

  describe('ALB events (path/httpMethod, requestContext.elb)', () => {
    it('answers the health check directly, without invoking any route handler', async () => {
      // ALB's own health-check probe carries no Origin header, so this
      // correctly gets no CORS headers back either - it doesn't need them.
      const result = await handler({
        path: '/api/health',
        httpMethod: 'GET',
        requestContext: { elb: {} },
      })

      expect(result).toEqual({ statusCode: 200, headers: {}, body: '', isBase64Encoded: false })
      expect(tripsHandlerMock).not.toHaveBeenCalled()
      expect(stopsHandlerMock).not.toHaveBeenCalled()
      expect(usersHandlerMock).not.toHaveBeenCalled()
    })

    it('answers OPTIONS preflight requests directly, with CORS headers for an allowed origin', async () => {
      const result = await handler({
        path: '/api/users',
        httpMethod: 'OPTIONS',
        headers: { origin: FRONTEND_ORIGIN },
        requestContext: { elb: {} },
      })

      expect(result).toEqual({ statusCode: 200, headers: corsHeadersFor(FRONTEND_ORIGIN), body: '', isBase64Encoded: false })
      expect(usersHandlerMock).not.toHaveBeenCalled()
    })

    it('answers OPTIONS preflight requests directly, without CORS headers for a disallowed origin', async () => {
      const result = await handler({
        path: '/api/users',
        httpMethod: 'OPTIONS',
        headers: { origin: 'https://evil.example.com' },
        requestContext: { elb: {} },
      })

      expect(result).toEqual({ statusCode: 200, headers: {}, body: '', isBase64Encoded: false })
    })

    it('reflects the localhost dev origin too', async () => {
      const result = await handler({
        path: '/api/users',
        httpMethod: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
        requestContext: { elb: {} },
      })

      expect(result.headers).toEqual(corsHeadersFor('http://localhost:5173'))
    })

    it('strips the /api prefix (frontend.tf\'s CloudFront behavior) before route matching', async () => {
      await handler({
        path: '/api/trips/trip-1/stops',
        httpMethod: 'GET',
        requestContext: { elb: {} },
      })

      const normalizedEvent = stopsHandlerMock.mock.calls[0][0]
      expect(normalizedEvent.path).toBe('/trips/trip-1/stops')
      expect(tripsHandlerMock).not.toHaveBeenCalled()
    })

    it('routes /api/users requests to the users handler', async () => {
      await handler({
        path: '/api/users',
        httpMethod: 'POST',
        requestContext: { elb: {} },
      })

      expect(usersHandlerMock).toHaveBeenCalledTimes(1)
      expect(usersHandlerMock.mock.calls[0][0].path).toBe('/users')
    })

    it('leaves requestContext.authorizer undefined so getAuthenticatedClaims falls back to the bearer token', async () => {
      await handler({
        path: '/api/trips',
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token' },
        requestContext: { elb: {} },
      })

      const normalizedEvent = tripsHandlerMock.mock.calls[0][0]
      expect(normalizedEvent.requestContext).toEqual({ authorizer: undefined })
      expect(normalizedEvent.headers).toEqual({ authorization: 'Bearer token' })
    })

    it("adds CORS headers to the route handler's response", async () => {
      tripsHandlerMock.mockResolvedValue({
        statusCode: 201,
        statusDescription: '201 Created',
        headers: { 'Content-Type': 'application/json' },
        body: '{"tripId":"trip-1"}',
      })

      const result = await handler({
        path: '/api/trips',
        httpMethod: 'POST',
        headers: { origin: FRONTEND_ORIGIN },
        requestContext: { elb: {} },
      })

      expect(result).toEqual({
        statusCode: 201,
        headers: { 'Content-Type': 'application/json', ...corsHeadersFor(FRONTEND_ORIGIN) },
        body: '{"tripId":"trip-1"}',
        isBase64Encoded: false,
      })
    })
  })
})
