// These claims label the UI only. Cognito and the backend enforce authentication.
export function readIdTokenIdentity(idToken: string): { userId: string; name: string } {
  const payload = idToken.split('.')[1]

  if (!payload) {
    throw new Error('ID token is not a valid JWT')
  }

  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  const claims = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown; name?: unknown }

  if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
    throw new Error('ID token is missing the sub claim')
  }

  return {
    userId: claims.sub,
    name: typeof claims.name === 'string' && claims.name.trim()
      ? claims.name.trim().split(/\s+/)[0]
      : 'Traveller',
  }
}

export function decodeIdTokenSub(idToken: string): string {
  return readIdTokenIdentity(idToken).userId
}
