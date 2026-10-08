import { createStop } from '../stops/createStop.js'
import { listStops } from '../stops/listStops.js'
import { updateStop, validateUpdateStopInput } from '../stops/updateStop.js'
import { deleteStop } from '../stops/deleteStop.js'
import { getTrip } from '../trips/getTrip.js'
import { getPlaceDetails } from '../places/getPlaceDetails.js'
import { mapToActivityCategory } from '../places/mapToActivityCategory.js'
import { resolvePlaceId } from '../places/resolvePlaceId.js'
import { geocodeAddress } from '../places/geocodeAddress.js'
import { placesClient } from '../lib/places.js'
import { RateLimitError, ServiceUnavailableError, UnauthorizedError, ValidationError } from '../lib/errors.js'
import { parseJsonBody } from '../lib/parseJsonBody.js'
import { isOrderCounterRow } from '../stops/orderCounter.js'
import { getAuthenticatedUserId } from '../lib/auth.js'
import { MAX_ADDRESS_LENGTH, MAX_DESTINATION_QUERY_LENGTH, MAX_PLACE_NAME_LENGTH, MAX_STOP_ID_LENGTH } from '../lib/limits.js'
import { enforcePlaceRequestRateLimit } from '../lib/rateLimit.js'

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
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

function jsonResponse(statusCode: number, payload: unknown): ALBResult {
  return {
    statusCode,
    statusDescription: `${statusCode} ${statusText[statusCode] ?? 'Error'}`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

// A malformed percent-encoding (e.g. a lone "%") makes decodeURIComponent
// throw a URIError, which isn't a server fault - it's bad input and should
// be a 400, not fall through to the generic 500 handler below.
function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new ValidationError('Invalid path segment')
  }
}

export async function handler(event: ALBEvent): Promise<ALBResult> {
  try {
    const stopsMatch = event.path.match(/^\/trips\/([^/]+)\/stops$/)
    const stopMatch = event.path.match(/^\/trips\/([^/]+)\/stops\/([^/]+)$/)

    if (!stopsMatch && !stopMatch) {
      return jsonResponse(404, { message: 'Not found' })
    }

    const tripId = decodePathSegment((stopsMatch ?? stopMatch)![1])

    // userId always comes from the verified ID token, never from a
    // client-supplied query param - otherwise any caller could read or
    // modify another user's stops just by naming their userId.
    const userId = await getAuthenticatedUserId(event)

    const trip = await getTrip({ userId, tripId })
    if (!trip) {
      return jsonResponse(404, { message: 'Trip not found' })
    }

    if (event.httpMethod === 'POST' && stopMatch?.[2] === 'resolve') {
      const { query, destination, address } = parseJsonBody(event.body)
      if (typeof query !== 'string' || !query.trim() || query.length > MAX_PLACE_NAME_LENGTH
        || typeof destination !== 'string' || !destination.trim() || destination.length > MAX_DESTINATION_QUERY_LENGTH
        || (address !== undefined && (typeof address !== 'string' || address.length > MAX_ADDRESS_LENGTH))) {
        throw new ValidationError('Invalid place lookup')
      }
      await enforcePlaceRequestRateLimit(userId)
      const placeId = await resolvePlaceId(query, destination, placesClient, address as string | undefined)
      const place = await getPlaceDetails(placeId, placesClient)
      return jsonResponse(200, { ...place, category: mapToActivityCategory(place.categories) })
    }

    if (event.httpMethod === 'POST' && stopsMatch) {
      const body = parseJsonBody(event.body)
      const query = body.query as string | undefined
      const destination = body.destination as string | undefined
      const address = body.address as string | undefined

      if (query !== undefined && (typeof query !== 'string' || query.length > MAX_PLACE_NAME_LENGTH)) {
        throw new ValidationError('Invalid place name')
      }
      if (destination !== undefined && (typeof destination !== 'string' || destination.length > MAX_DESTINATION_QUERY_LENGTH)) {
        throw new ValidationError('Invalid destination')
      }
      if (address !== undefined && (typeof address !== 'string' || address.length > MAX_ADDRESS_LENGTH)) {
        throw new ValidationError('Invalid address')
      }

      // Every path below can trigger a billable Amazon Location Places API call
      // (GetPlace, Geocode, or Suggest) against the shared AWS account - bound
      // how often one user can do that, regardless of which path it takes. Runs
      // after the checks above so a request that fails basic validation doesn't
      // spend part of the caller's budget for nothing.
      await enforcePlaceRequestRateLimit(userId)

      let placeId = body.placeId as string | undefined
      if (!placeId && body.placeSelected && query && destination) {
        placeId = await resolvePlaceId(query, destination, placesClient, address)
      }

      let manualPlace: { name: string; location?: { lat: number; lng: number } } | undefined
      if (!placeId && query) {
        const location = address ? await geocodeAddress(address, placesClient) : undefined
        manualPlace = { name: query, location }
      }

      const stop = await createStop({
        ...body,
        tripId,
        userId,
        placeId,
        manualPlace,
        tripStartDate: trip.startDate,
        tripEndDate: trip.endDate,
      })
      return jsonResponse(201, stop)
    }

    if (event.httpMethod === 'GET' && stopsMatch) {
      const stops = await listStops(tripId)
      return jsonResponse(200, stops)
    }

    if (event.httpMethod === 'PATCH' && stopMatch) {
      const stopId = decodePathSegment(stopMatch[2])
      if (stopId.length > MAX_STOP_ID_LENGTH) throw new ValidationError('Invalid stop id')
      if (isOrderCounterRow(stopId)) {
        return jsonResponse(404, { message: 'Stop not found' })
      }
      const input = parseJsonBody(event.body)
      if (!validateUpdateStopInput(input)) throw new ValidationError('Invalid stop update input')
      if (input.placeId !== undefined || (typeof input.address === 'string' && input.address.trim())) await enforcePlaceRequestRateLimit(userId)
      const stop = await updateStop(tripId, stopId, input)
      if (!stop) {
        return jsonResponse(404, { message: 'Stop not found' })
      }
      return jsonResponse(200, stop)
    }

    if (event.httpMethod === 'DELETE' && stopMatch) {
      const stopId = decodePathSegment(stopMatch[2])
      if (stopId.length > MAX_STOP_ID_LENGTH) throw new ValidationError('Invalid stop id')
      if (isOrderCounterRow(stopId)) {
        return jsonResponse(404, { message: 'Stop not found' })
      }
      await deleteStop(tripId, stopId)
      return jsonResponse(200, { message: 'Deleted' })
    }

    return jsonResponse(404, { message: 'Not found' })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonResponse(401, { message: error.message })
    }
    if (error instanceof ServiceUnavailableError) {
      return jsonResponse(503, { message: error.message })
    }
    if (error instanceof RateLimitError) {
      return jsonResponse(429, { message: error.message })
    }
    if (error instanceof ValidationError) {
      return jsonResponse(400, { message: error.message })
    }
    console.error(error)
    return jsonResponse(500, { message: 'Internal server error' })
  }
}
