import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: vi.fn(() => ({ verify: verifyMock })),
  },
}))

import { getAuthenticatedClaims, getAuthenticatedUserId } from './auth.js'
import { UnauthorizedError } from './errors.js'

describe('auth', () => {
  beforeEach(() => {
    verifyMock.mockReset()
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_test'
    process.env.COGNITO_CLIENT_ID = 'test-client-id'
  })

  it('throws UnauthorizedError when there are no headers at all', async () => {
    await expect(getAuthenticatedUserId({})).rejects.toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError when the Authorization header is missing', async () => {
    await expect(getAuthenticatedUserId({ headers: {} })).rejects.toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError when the header is not a bearer token', async () => {
    await expect(
      getAuthenticatedUserId({ headers: { Authorization: 'Basic abc123' } }),
    ).rejects.toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError when the token fails verification', async () => {
    verifyMock.mockRejectedValue(new Error('invalid signature'))

    await expect(
      getAuthenticatedUserId({ headers: { Authorization: 'Bearer bad-token' } }),
    ).rejects.toThrow(UnauthorizedError)
  })

  it('returns the verified sub claim as the userId', async () => {
    verifyMock.mockResolvedValue({ sub: 'user-1', email: 'kai@example.com' })

    await expect(
      getAuthenticatedUserId({ headers: { Authorization: 'Bearer good-token' } }),
    ).resolves.toBe('user-1')
    expect(verifyMock).toHaveBeenCalledWith('good-token')
  })

  it('returns the full verified claims and accepts a lowercase header name', async () => {
    verifyMock.mockResolvedValue({ sub: 'user-1', email: 'kai@example.com', name: 'Kai' })

    const claims = await getAuthenticatedClaims({ headers: { authorization: 'Bearer good-token' } })

    expect(claims).toEqual({ sub: 'user-1', email: 'kai@example.com', name: 'Kai' })
  })

  it('trusts API Gateway authorizer claims directly, without verifying a token', async () => {
    const claims = await getAuthenticatedClaims({
      requestContext: { authorizer: { jwt: { claims: { sub: 'user-1', email: 'kai@example.com' } } } },
    })

    expect(claims).toEqual({ sub: 'user-1', email: 'kai@example.com', name: undefined })
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('falls back to bearer-token verification when authorizer claims have no sub', async () => {
    verifyMock.mockResolvedValue({ sub: 'user-1', email: 'kai@example.com' })

    await expect(
      getAuthenticatedUserId({
        requestContext: { authorizer: {} },
        headers: { Authorization: 'Bearer good-token' },
      }),
    ).resolves.toBe('user-1')
    expect(verifyMock).toHaveBeenCalledWith('good-token')
  })
})
