import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { UnauthorizedError } from '../lib/errors.js'

vi.mock('../lib/auth.js', () => ({
  getAuthenticatedClaims: vi.fn(),
}))

import { getAuthenticatedClaims } from '../lib/auth.js'
import { handler } from './users.js'

const ddbMock = mockClient(DynamoDBDocumentClient)
const authMock = vi.mocked(getAuthenticatedClaims)

beforeEach(() => {
  ddbMock.reset()
  authMock.mockReset()
  authMock.mockResolvedValue({ sub: 'user-1', email: 'kai@example.com', name: 'Kai' })
})

describe('POST /users', () => {
  it('creates a user profile from the verified token claims and returns 201', async () => {
    ddbMock.on(PutCommand).resolves({})

    // A body-supplied identity must never be trusted - only the verified
    // token claims (mocked above) should end up in the created profile.
    const result = await handler({
      httpMethod: 'POST',
      path: '/users',
      body: JSON.stringify({ userId: 'someone-else', email: 'attacker@example.com' }),
    })

    expect(result.statusCode).toBe(201)
    const user = JSON.parse(result.body)
    expect(user.userId).toBe('user-1')
    expect(user.email).toBe('kai@example.com')
  })

  it('works with no request body, deriving everything from the token', async () => {
    ddbMock.on(PutCommand).resolves({})

    const result = await handler({ httpMethod: 'POST', path: '/users' })

    expect(result.statusCode).toBe(201)
    expect(JSON.parse(result.body).userId).toBe('user-1')
  })

  it('returns 401 when the bearer token is missing or invalid', async () => {
    authMock.mockRejectedValueOnce(new UnauthorizedError('Missing bearer token'))

    const result = await handler({ httpMethod: 'POST', path: '/users' })

    expect(result.statusCode).toBe(401)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('returns 400 for invalid input', async () => {
    authMock.mockResolvedValue({ sub: 'user-1' })

    const result = await handler({ httpMethod: 'POST', path: '/users' })

    expect(result.statusCode).toBe(400)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('returns 500 with a generic message when DynamoDB fails unexpectedly', async () => {
    ddbMock.on(PutCommand).rejects(new Error('AccessDeniedException: not authorized'))

    const result = await handler({ httpMethod: 'POST', path: '/users' })

    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body).message).toBe('Internal server error')
  })
})

describe('unknown routes', () => {
  it('returns 404', async () => {
    const result = await handler({ httpMethod: 'GET', path: '/users' })
    expect(result.statusCode).toBe(404)
  })
})
