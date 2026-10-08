import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('cognito config', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not throw on import alone, only when the client ID is actually requested without it set', async () => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', '')

    const { getCognitoClientId } = await import('./cognito')

    expect(() => getCognitoClientId()).toThrow(/VITE_COGNITO_CLIENT_ID/)
  })

  it('uses the configured client ID and region', async () => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client-id')
    vi.stubEnv('VITE_AWS_REGION', 'ap-southeast-2')

    const { getCognitoClientId, cognitoClient } = await import('./cognito')

    expect(getCognitoClientId()).toBe('test-client-id')
    expect(await cognitoClient.config.region()).toBe('ap-southeast-2')
  })

  it('defaults the region to us-east-1 when unset', async () => {
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client-id')

    const { cognitoClient } = await import('./cognito')

    expect(await cognitoClient.config.region()).toBe('us-east-1')
  })
})
