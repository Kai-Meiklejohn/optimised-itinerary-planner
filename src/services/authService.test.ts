import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

vi.mock('../config/cognito', () => ({
  getCognitoClientId: () => 'test-client-id',
  cognitoClient: { send: sendMock },
}))

import { confirmSignUpUser, restoreSession, refreshSession, signOutUser, signInUser, signUpUser } from './authService'

describe('signUpUser', () => {
  beforeEach(() => {
    sendMock.mockReset()
    localStorage.clear()
  })

  it('includes the required name and email attributes for custom sign up', async () => {
    sendMock.mockResolvedValue({})

    await signUpUser('kai@example.com', 'Password123!', 'Kai Meiklejohn')

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Username: 'kai@example.com',
          Password: 'Password123!',
          UserAttributes: expect.arrayContaining([
            expect.objectContaining({ Name: 'email', Value: 'kai@example.com' }),
            expect.objectContaining({ Name: 'name', Value: 'Kai Meiklejohn' }),
          ]),
        }),
      }),
    )
  })
})

describe('signInUser', () => {
  beforeEach(() => {
    sendMock.mockReset()
    localStorage.clear()
  })

  it('returns and stores the Cognito JWTs', async () => {
    sendMock.mockResolvedValue({
      AuthenticationResult: {
        AccessToken: 'access-token',
        IdToken: 'id-token',
        RefreshToken: 'refresh-token',
      },
    })

    await expect(signInUser('kai@example.com', 'password123')).resolves.toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
    })
    expect(localStorage.getItem('accessToken')).toBe('access-token')
    expect(localStorage.getItem('idToken')).toBe('id-token')
    expect(localStorage.getItem('refreshToken')).toBe('refresh-token')
  })

  it('rejects a response without both required JWTs', async () => {
    sendMock.mockResolvedValue({
      AuthenticationResult: { AccessToken: 'access-token' },
    })

    await expect(signInUser('kai@example.com', 'password123')).rejects.toThrow(
      'Sign in succeeded without the required authentication tokens.',
    )
    expect(localStorage).not.toHaveProperty('accessToken')
    expect(localStorage).not.toHaveProperty('idToken')
  })
})

describe('refreshSession', () => {
  beforeEach(() => {
    sendMock.mockReset()
    localStorage.clear()
  })

  it('throws without calling Cognito when there is no stored refresh token', async () => {
    await expect(refreshSession()).rejects.toThrow('No refresh token is available')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('exchanges the stored refresh token for new tokens and stores them', async () => {
    localStorage.setItem('refreshToken', 'refresh-token')
    sendMock.mockResolvedValue({
      AuthenticationResult: { AccessToken: 'new-access-token', IdToken: 'new-id-token' },
    })

    const tokens = await refreshSession()

    expect(tokens).toEqual({ accessToken: 'new-access-token', idToken: 'new-id-token', refreshToken: 'refresh-token' })
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: 'refresh-token' },
        }),
      }),
    )
    expect(localStorage.getItem('idToken')).toBe('new-id-token')
    expect(localStorage.getItem('accessToken')).toBe('new-access-token')
    expect(localStorage.getItem('refreshToken')).toBe('refresh-token')
  })

  it('stores a rotated refresh token when Cognito returns one', async () => {
    localStorage.setItem('refreshToken', 'old-refresh-token')
    sendMock.mockResolvedValue({
      AuthenticationResult: { AccessToken: 'new-access-token', IdToken: 'new-id-token', RefreshToken: 'rotated-refresh-token' },
    })

    await refreshSession()

    expect(localStorage.getItem('refreshToken')).toBe('rotated-refresh-token')
  })

  it('rejects a response without the required tokens', async () => {
    localStorage.setItem('refreshToken', 'refresh-token')
    sendMock.mockResolvedValue({ AuthenticationResult: {} })

    await expect(refreshSession()).rejects.toThrow('Session refresh did not return the required authentication tokens.')
  })
})

describe('confirmSignUpUser', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('treats an already-confirmed user as success instead of throwing', async () => {
    const error = Object.assign(new Error('User cannot be confirmed. Current status is CONFIRMED'), {
      name: 'NotAuthorizedException',
    })
    sendMock.mockRejectedValue(error)

    await expect(confirmSignUpUser('kai@example.com', '123456')).resolves.toBeUndefined()
  })

  it('still throws other Cognito errors', async () => {
    const error = Object.assign(new Error('Invalid verification code provided'), {
      name: 'CodeMismatchException',
    })
    sendMock.mockRejectedValue(error)

    await expect(confirmSignUpUser('kai@example.com', '000000')).rejects.toThrow(
      'Invalid verification code provided',
    )
  })
})
function deferredAuth() {
  let resolve!: (value: unknown) => void
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const renewed = { AuthenticationResult: { AccessToken: 'new-access', IdToken: 'new-id' } }

describe('session lifecycle', () => {
  beforeEach(() => {
    signOutUser()
    sendMock.mockReset()
    localStorage.setItem('refreshToken', 'old-refresh')
  })

  it('does not restore tokens after logout while refresh is pending', async () => {
    const pending = deferredAuth()
    sendMock.mockReturnValue(pending.promise)
    const refresh = refreshSession()
    const rejected = expect(refresh).rejects.toThrow('Session changed')
    signOutUser()
    pending.resolve(renewed)
    await rejected
    expect(localStorage.getItem('idToken')).toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
  })

  it('does not overwrite a newer account after a delayed refresh', async () => {
    const pending = deferredAuth()
    sendMock.mockReturnValueOnce(pending.promise)
    const refresh = refreshSession()
    const rejected = expect(refresh).rejects.toThrow('Session changed')
    sendMock.mockResolvedValueOnce({ AuthenticationResult: { AccessToken: 'other-access', IdToken: 'other-id', RefreshToken: 'other-refresh' } })
    await signInUser('other@example.com', 'password')
    pending.resolve(renewed)
    await rejected
    expect(localStorage.getItem('idToken')).toBe('other-id')
    expect(localStorage.getItem('refreshToken')).toBe('other-refresh')
  })

  it('shares one refresh request between concurrent callers', async () => {
    const pending = deferredAuth()
    sendMock.mockReturnValue(pending.promise)
    const first = refreshSession()
    const second = refreshSession()
    expect(sendMock).toHaveBeenCalledTimes(1)
    pending.resolve(renewed)
    await expect(first).resolves.toEqual(await second)
  })

  it('discards a pending sign-in after logout', async () => {
    const pending = deferredAuth()
    sendMock.mockReturnValue(pending.promise)
    const login = signInUser('kai@example.com', 'password')
    const rejected = expect(login).rejects.toThrow('Session changed')
    signOutUser()
    pending.resolve(renewed)
    await rejected
    expect(localStorage.getItem('idToken')).toBeNull()
  })

  it('clears local tokens before remote revocation settles', async () => {
    localStorage.setItem('idToken', 'old-id')
    localStorage.setItem('accessToken', 'old-access')
    sendMock.mockReturnValue(new Promise(() => {}))
    void signOutUser()
    expect(sendMock).toHaveBeenCalledOnce()
    expect(localStorage.getItem('idToken')).toBeNull()
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
  })

  it('does not restore a session removed by another tab', async () => {
    const pending = deferredAuth()
    sendMock.mockReturnValue(pending.promise)
    const refresh = refreshSession()
    const rejected = expect(refresh).rejects.toThrow('Session changed')
    localStorage.clear()
    pending.resolve(renewed)
    await rejected
    expect(localStorage.getItem('idToken')).toBeNull()
  })
})

describe('restoreSession', () => {
  beforeEach(() => { signOutUser(); sendMock.mockReset() })

  it('returns no session without stored credentials', async () => {
    await expect(restoreSession()).resolves.toBeNull()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('validates saved credentials with Cognito before returning tokens', async () => {
    localStorage.setItem('refreshToken', 'saved-refresh')
    sendMock.mockResolvedValue(renewed)
    await expect(restoreSession()).resolves.toMatchObject({ idToken: 'new-id' })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('clears rejected credentials', async () => {
    localStorage.setItem('refreshToken', 'revoked-refresh')
    sendMock.mockRejectedValue(Object.assign(new Error('Revoked'), { name: 'NotAuthorizedException' }))
    await expect(restoreSession()).resolves.toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
  })

  it('preserves credentials during a temporary network failure', async () => {
    localStorage.setItem('refreshToken', 'saved-refresh')
    sendMock.mockRejectedValue(new Error('Offline'))
    await expect(restoreSession()).rejects.toThrow('Offline')
    expect(localStorage.getItem('refreshToken')).toBe('saved-refresh')
  })

  it('does not clear a newer session when an old refresh is rejected', async () => {
    let reject!: (error: Error) => void
    const pending = { promise: new Promise<never>((_, fail) => { reject = fail }), reject: (error: Error) => reject(error) }
    localStorage.setItem('refreshToken', 'old-refresh')
    sendMock.mockReturnValueOnce(pending.promise)
    const restoring = restoreSession()
    const rejected = expect(restoring).rejects.toThrow()
    localStorage.setItem('refreshToken', 'new-refresh')
    pending.reject(Object.assign(new Error('Revoked'), { name: 'NotAuthorizedException' }))
    await rejected
    expect(localStorage.getItem('refreshToken')).toBe('new-refresh')
  })
})

it('revokes the saved refresh token on logout while clearing local credentials immediately', async () => {
  localStorage.setItem('refreshToken', 'logout-refresh')
  sendMock.mockClear().mockResolvedValue({})
  signOutUser()
  expect(localStorage.getItem('refreshToken')).toBeNull()
  expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ input: { ClientId: 'test-client-id', Token: 'logout-refresh' } }))
})
