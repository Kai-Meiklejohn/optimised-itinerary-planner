import { describe, expect, it } from 'vitest'
import { decodeIdTokenSub } from './jwt'

function toBase64Url(value: string) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function buildIdToken(payload: Record<string, unknown>) {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = toBase64Url(JSON.stringify(payload))
  return `${header}.${body}.fake-signature`
}

describe('decodeIdTokenSub', () => {
  it('extracts the sub claim from a well-formed ID token', () => {
    const token = buildIdToken({ sub: 'abc-123', email: 'kai@example.com' })

    expect(decodeIdTokenSub(token)).toBe('abc-123')
  })

  it('decodes a base64url payload whose length needs padding restored', () => {
    const token = buildIdToken({ sub: 'a-sub-value-that-needs-padding' })

    expect(decodeIdTokenSub(token)).toBe('a-sub-value-that-needs-padding')
  })

  it('throws when the token has no payload segment', () => {
    expect(() => decodeIdTokenSub('not-a-jwt')).toThrow('ID token is not a valid JWT')
  })

  it('throws when the payload has no sub claim', () => {
    const token = buildIdToken({ email: 'kai@example.com' })

    expect(() => decodeIdTokenSub(token)).toThrow('ID token is missing the sub claim')
  })
})
