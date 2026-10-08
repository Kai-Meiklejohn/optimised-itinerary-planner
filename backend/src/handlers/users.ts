import { createUser } from '../users/createUser.js'
import { UnauthorizedError, ValidationError } from '../lib/errors.js'
import { getAuthenticatedClaims } from '../lib/auth.js'

type ALBEvent = {
  httpMethod: string
  path: string
  headers?: Record<string, string | undefined> | null
  body?: string | null
  requestContext?: {
    authorizer?: { jwt?: { claims?: Record<string, string | undefined> } }
  }
}

type ALBResult = {
  statusCode: number
  statusDescription: string
  headers: Record<string, string>
  body: string
}

const statusText: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  500: 'Internal Server Error',
}

function jsonResponse(statusCode: number, payload: unknown): ALBResult {
  return {
    statusCode,
    statusDescription: `${statusCode} ${statusText[statusCode] ?? 'Error'}`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

export async function handler(event: ALBEvent): Promise<ALBResult> {
  try {
    if (event.httpMethod === 'POST' && event.path === '/users') {
      // userId, email, and displayName always come from the verified ID
      // token, never from the request body - a client must not be able to
      // create a profile claiming someone else's identity.
      const claims = await getAuthenticatedClaims(event)
      const user = await createUser({
        userId: claims.sub,
        email: claims.email,
        displayName: claims.name ?? claims.email?.split('@')[0],
      })
      return jsonResponse(201, user)
    }

    return jsonResponse(404, { message: 'Not found' })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonResponse(401, { message: error.message })
    }
    if (error instanceof ValidationError) {
      return jsonResponse(400, { message: error.message })
    }
    console.error(error)
    return jsonResponse(500, { message: 'Internal server error' })
  }
}
