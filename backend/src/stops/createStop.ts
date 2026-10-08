import { randomUUID } from 'node:crypto'
import { TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { GeoPlacesClient } from '@aws-sdk/client-geo-places'
import { docClient, STOP_TABLE, TRIP_TABLE } from '../lib/dynamo.js'
import { ValidationError } from '../lib/errors.js'
import { isValidCalendarDate } from '../lib/isValidCalendarDate.js'
import { isValidTime } from '../lib/isValidTime.js'
import {
  MAX_ADDRESS_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  MAX_PRIORITY,
  MAX_VISIT_DURATION_MINUTES,
  MIN_PRIORITY,
} from '../lib/limits.js'
import { placesClient } from '../lib/places.js'
import { geocodeAddress } from '../places/geocodeAddress.js'
import { getPlaceDetails } from '../places/getPlaceDetails.js'
import { ACTIVITY_CATEGORIES, mapToActivityCategory, type ActivityCategory } from '../places/mapToActivityCategory.js'
import { assertNoOverlap, readSchedule, scheduleRevisionWrite } from './schedule.js'
import { getNextOrder } from './orderCounter.js'

export type CreateStopInput = {
  tripId: string
  // Set by the handler from the already-verified owner, never from the client body -
  // used only to guard against creating a stop for a trip that's being deleted
  // concurrently, not for ownership (that's already checked before this is called).
  userId: string
  placeId?: string
  manualPlace?: { name: string; location?: { lat: number; lng: number } }
  category?: ActivityCategory
  visitDurationMinutes: number
  priority: number
  date?: string
  time?: string
  notes?: string
  address?: string
  // Set by the handler from the already-fetched trip, never from the client body,
  // so a stop's date can be checked against the trip's own date range.
  tripStartDate?: string
  tripEndDate?: string
}

export type Stop = {
  tripId: string
  stopId: string
  placeName: string
  category: ActivityCategory
  location?: { lat: number; lng: number }
  placeId: string
  visitDurationMinutes: number
  priority: number
  date?: string
  time?: string
  notes?: string
  address?: string
  order: number
  addedAt: string
}

export function validateCreateStopInput(input: Partial<CreateStopInput>): input is CreateStopInput {
  const hasPlace = (typeof input.placeId === 'string' && input.placeId.length > 0)
    || (typeof input.manualPlace?.name === 'string' && input.manualPlace.name.trim().length > 0)

  return (
    typeof input.tripId === 'string' && input.tripId.length > 0
    && typeof input.userId === 'string' && input.userId.length > 0
    && hasPlace
    && (input.manualPlace === undefined || input.manualPlace.name.length <= MAX_PLACE_NAME_LENGTH)
    && typeof input.visitDurationMinutes === 'number' && Number.isFinite(input.visitDurationMinutes)
      && input.visitDurationMinutes > 0 && input.visitDurationMinutes <= MAX_VISIT_DURATION_MINUTES
    && typeof input.priority === 'number' && Number.isFinite(input.priority)
      && input.priority >= MIN_PRIORITY && input.priority <= MAX_PRIORITY
    && (input.date === undefined || (
      typeof input.date === 'string' && isValidCalendarDate(input.date)
      && (input.tripStartDate === undefined || input.date >= input.tripStartDate)
      && (input.tripEndDate === undefined || input.date <= input.tripEndDate)
    ))
    && (input.time === undefined || (typeof input.time === 'string' && isValidTime(input.time)))
    && (input.notes === undefined || (typeof input.notes === 'string' && input.notes.length <= MAX_NOTES_LENGTH))
    && (input.address === undefined || (typeof input.address === 'string' && input.address.length <= MAX_ADDRESS_LENGTH))
    && (input.category === undefined || (ACTIVITY_CATEGORIES as string[]).includes(input.category))
  )
}

export async function createStop(
  input: Partial<CreateStopInput>,
  dynamo: DynamoDBDocumentClient = docClient,
  geoPlaces: GeoPlacesClient = placesClient,
): Promise<Stop> {
  if (!validateCreateStopInput(input)) {
    throw new ValidationError('Invalid stop input')
  }

  const schedule = input.date && input.time ? await readSchedule(input.tripId, dynamo) : undefined
  if (schedule) assertNoOverlap(input, schedule.stops)

  const place = input.placeId
    ? await getPlaceDetails(input.placeId, geoPlaces).catch((error: unknown) => {
        if (error instanceof Error && (error.name === 'ResourceNotFoundException' || error.name === 'ValidationException')) {
          throw new ValidationError(`Could not find a place matching placeId "${input.placeId}"`)
        }
        throw error
      })
    : {
        placeId: randomUUID(),
        name: input.manualPlace!.name.trim(),
        location: input.manualPlace!.location,
        categories: [] as string[],
      }
  if (input.placeId && input.address !== undefined) {
    const address = input.address.trim()
    if (!address) place.location = undefined
    else if (address !== place.address?.trim()) place.location = await geocodeAddress(address, geoPlaces)
  }
  const order = await getNextOrder(input.tripId, input.date, dynamo)

  const stop: Stop = {
    tripId: input.tripId,
    stopId: randomUUID(),
    placeName: place.name,
    category: input.category ?? mapToActivityCategory(place.categories),
    location: place.location,
    placeId: place.placeId,
    visitDurationMinutes: input.visitDurationMinutes,
    priority: input.priority,
    date: input.date,
    time: input.time,
    notes: input.notes?.trim() || undefined,
    address: (input.address ?? place.address)?.trim() || undefined,
    order,
    addedAt: new Date().toISOString(),
  }

  try {
    await dynamo.send(
      new TransactWriteCommand({
        TransactItems: [
          ...(schedule ? [scheduleRevisionWrite(input.tripId, schedule.revision)] : []),
          {
            ConditionCheck: {
              TableName: TRIP_TABLE,
              Key: { userId: input.userId, tripId: input.tripId },
              ConditionExpression: 'attribute_exists(tripId) AND attribute_not_exists(deleting)',
            },
          },
          {
            Put: {
              TableName: STOP_TABLE,
              Item: stop,
            },
          },
        ],
      }),
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'TransactionCanceledException') {
      throw new ValidationError('The trip or schedule changed. Reload the itinerary and try again.')
    }
    throw error
  }

  return stop
}
