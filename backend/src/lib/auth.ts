import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { UnauthorizedError } from './errors.js'

export type AuthenticatedClaims = {
  sub: string
  email?: string
  name?: string
}

type Verifier = {
  verify(token: string): Promise<AuthenticatedClaims>
}

type AuthEvent = {
  headers?: Record<string, string | undefined> | null
  requestContext?: {
    authorizer?: {
      jwt?: {
        claims?: Record<string, string | undefined>
      }
    }
  }
}

let cachedVerifier: Verifier | undefined

function getVerifier(): Verifier {
  if (!cachedVerifier) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID
    const clientId = process.env.COGNITO_CLIENT_ID
    if (!userPoolId || !clientId) {
      throw new Error('Missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID environment variable')
    }
    cachedVerifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'id',
      clientId,
    }) as unknown as Verifier
  }
  return cachedVerifier
}

function extractBearerToken(headers: AuthEvent['headers']): string | undefined {
  if (!headers) {
    return undefined
  }
  const header = headers.Authorization ?? headers.authorization
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

// API Gateway events may contain claims verified by its configured JWT authoriser.
// Local HTTP and ALB requests verify the bearer token below.
export async function getAuthenticatedClaims(event: AuthEvent): Promise<AuthenticatedClaims> {
  const jwtClaims = event.requestContext?.authorizer?.jwt?.claims
  if (jwtClaims?.sub) {
    return { sub: jwtClaims.sub, email: jwtClaims.email, name: jwtClaims.name }
  }

  const token = extractBearerToken(event.headers)
  if (!token) {
    throw new UnauthorizedError('Missing bearer token')
  }

  try {
    return await getVerifier().verify(token)
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
}

export async function getAuthenticatedUserId(event: AuthEvent): Promise<string> {
  const claims = await getAuthenticatedClaims(event)
  return claims.sub
}
