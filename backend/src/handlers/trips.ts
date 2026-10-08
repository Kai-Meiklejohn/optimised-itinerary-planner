import { createTrip } from '../trips/createTrip.js'
import { getTrip } from '../trips/getTrip.js'
import { listTrips } from '../trips/listTrips.js'
import { updateTrip } from '../trips/updateTrip.js'
import { deleteTrip } from '../trips/deleteTrip.js'
import { UnauthorizedError, ValidationError } from '../lib/errors.js'
import { parseJsonBody } from '../lib/parseJsonBody.js'
import { getAuthenticatedUserId } from '../lib/auth.js'

type ALBEvent = {
  httpMethod: string
  path: string
  queryStringParameters?: Record<string, string> | null
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
    // userId always comes from the verified ID token, never from a
    // client-supplied query/body param - otherwise any caller could read or
    // modify another user's trips just by naming their userId.
    const userId = await getAuthenticatedUserId(event)

    if (event.httpMethod === 'POST' && event.path === '/trips') {
      const input = parseJsonBody(event.body)
      const trip = await createTrip({ ...input, userId })
      return jsonResponse(201, trip)
    }

    if (event.httpMethod === 'GET' && event.path === '/trips') {
      const trips = await listTrips(userId)
      return jsonResponse(200, trips)
    }

    const tripMatch = event.path.match(/^\/trips\/([^/]+)$/)

    if (event.httpMethod === 'GET' && tripMatch) {
      const tripId = tripMatch[1]
      const trip = await getTrip({ userId, tripId })
      if (!trip) {
        return jsonResponse(404, { message: 'Trip not found' })
      }
      return jsonResponse(200, trip)
    }

    if (event.httpMethod === 'PATCH' && tripMatch) {
      const tripId = tripMatch[1]
      const input = parseJsonBody(event.body)
      const trip = await updateTrip(userId, tripId, input)
      if (!trip) {
        return jsonResponse(404, { message: 'Trip not found' })
      }
      return jsonResponse(200, trip)
    }

    if (event.httpMethod === 'DELETE' && tripMatch) {
      const tripId = tripMatch[1]
      const deleted = await deleteTrip(userId, tripId)
      if (!deleted) {
        return jsonResponse(404, { message: 'Trip not found' })
      }
      return jsonResponse(200, { message: 'Deleted' })
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
