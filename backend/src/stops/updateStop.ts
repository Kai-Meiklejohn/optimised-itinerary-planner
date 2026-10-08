import { GetCommand, TransactWriteCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { GeoPlacesClient } from '@aws-sdk/client-geo-places'
import { docClient, STOP_TABLE } from '../lib/dynamo.js'
import { ValidationError } from '../lib/errors.js'
import { isValidTime } from '../lib/isValidTime.js'
import { MAX_ADDRESS_LENGTH, MAX_STOP_ID_LENGTH, MAX_VISIT_DURATION_MINUTES, MAX_NOTES_LENGTH } from '../lib/limits.js'
import { placesClient } from '../lib/places.js'
import { geocodeAddress } from '../places/geocodeAddress.js'
import { getPlaceDetails } from '../places/getPlaceDetails.js'
import { ACTIVITY_CATEGORIES, type ActivityCategory } from '../places/mapToActivityCategory.js'
import { getNextOrder, isOrderCounterRow } from './orderCounter.js'
import { assertNoOverlap, readSchedule, scheduleRevisionWrite } from './schedule.js'
import type { Stop } from './createStop.js'

// Used for "move to start" (nextOrder - ORDER_GAP is always negative or at
// worst 0 once repeated, and createStop's counter-based orders only ever
// count upward from 1 * ORDER_STEP, so it can never collide with one of
// those) and as a floor for "move to end" alongside a fresh getNextOrder()
// call - see computeReorderedPosition below for why "move to end" can't rely
// on this arithmetic alone.
const ORDER_GAP = 1000

export type UpdateStopInput = {
  time?: string
  notes?: string
  category?: ActivityCategory
  visitDurationMinutes?: number
  address?: string
  placeId?: string
  // Reposition this stop to sit immediately after previousStopId and/or
  // immediately before nextStopId (both within the same day) - omit
  // previousStopId to move it to the start of the day, or nextStopId for the
  // end. The new `order` value is computed server-side (the midpoint between
  // the two neighbours' own order values) so callers never need to know
  // about the gapped-counter scheme itself.
  previousStopId?: string
  nextStopId?: string
}

export function validateUpdateStopInput(input: UpdateStopInput): boolean {
  const hasTime = input.time !== undefined
  const hasNotes = input.notes !== undefined
  const hasReorder = input.previousStopId !== undefined || input.nextStopId !== undefined

  if (!hasTime && !hasNotes && !hasReorder && input.category === undefined && input.visitDurationMinutes === undefined && input.address === undefined && input.placeId === undefined) {
    return false
  }

  if (hasTime && (typeof input.time !== 'string' || (input.time !== '' && !isValidTime(input.time)))) {
    return false
  }

  if (hasNotes && (typeof input.notes !== 'string' || input.notes.length > MAX_NOTES_LENGTH)) {
    return false
  }

  for (const neighbourId of [input.previousStopId, input.nextStopId]) {
    if (neighbourId === undefined) continue
    if (typeof neighbourId !== 'string' || neighbourId.length === 0 || neighbourId.length > MAX_STOP_ID_LENGTH) {
      return false
    }
    // Reserved for orderCounter.ts's own internal per-day counter rows, never
    // a real stop - reject outright rather than let it reach a DynamoDB read
    // that would "succeed" against a row with no order/date fields.
    if (isOrderCounterRow(neighbourId)) {
      return false
    }
  }

  // A stop can't be reordered between a neighbour and itself - reject
  // explicitly rather than relying on the midpoint math to incidentally
  // catch it (two identical-key ConditionCheck items would otherwise reach
  // the transaction, which DynamoDB rejects with an error outside the
  // TransactionCanceledException handling below).
  if (input.previousStopId !== undefined && input.previousStopId === input.nextStopId) {
    return false
  }

  if (input.category !== undefined && !ACTIVITY_CATEGORIES.includes(input.category)) return false
  if (input.visitDurationMinutes !== undefined && (typeof input.visitDurationMinutes !== 'number'
    || !Number.isFinite(input.visitDurationMinutes) || input.visitDurationMinutes < 1
    || input.visitDurationMinutes > MAX_VISIT_DURATION_MINUTES)) return false
  if (input.address !== undefined && (typeof input.address !== 'string' || input.address.length > MAX_ADDRESS_LENGTH)) return false
  if (input.placeId !== undefined && (typeof input.placeId !== 'string' || !input.placeId.trim() || input.placeId.length > 500)) return false
  return true
}

async function getStop(
  tripId: string,
  targetStopId: string,
  client: DynamoDBDocumentClient,
): Promise<Stop | undefined> {
  const result = await client.send(
    // A stop just created or reordered should be visible to the very next
    // reorder that names it as a neighbour, not after DynamoDB's
    // eventual-consistency delay - matches readSchedule/listStops.
    new GetCommand({ TableName: STOP_TABLE, Key: { tripId, stopId: targetStopId }, ConsistentRead: true }),
  )
  return result.Item as Stop | undefined
}

async function getNeighbour(
  tripId: string,
  neighbourStopId: string,
  client: DynamoDBDocumentClient,
): Promise<Stop> {
  const stop = await getStop(tripId, neighbourStopId, client)
  if (!stop) {
    throw new ValidationError(`Could not find a neighbouring stop "${neighbourStopId}" to reorder against`)
  }
  return stop
}

// One entry per neighbour actually used to compute the new position, so the
// caller can guard the write against that neighbour's own order having
// changed in the meantime (see ReorderResult below).
type OrderGuard = { stopId: string; order: number }

type ReorderResult = {
  order: number
  target: Stop | undefined
  guards: OrderGuard[]
}

async function computeReorderedPosition(
  tripId: string,
  stopId: string,
  input: UpdateStopInput,
  client: DynamoDBDocumentClient,
): Promise<ReorderResult> {
  const [target, previous, next] = await Promise.all([
    getStop(tripId, stopId, client),
    input.previousStopId ? getNeighbour(tripId, input.previousStopId, client) : undefined,
    input.nextStopId ? getNeighbour(tripId, input.nextStopId, client) : undefined,
  ])

  // order is scoped per day (orderCounter.ts restarts its gapped sequence for
  // each date), so a neighbour from a different day has a number that isn't
  // comparable at all - reject rather than silently mis-positioning the stop
  // within its own day. Skipped if the target itself is already gone; the
  // final conditional write below is what correctly reports that as a 404
  // rather than this throwing a validation error instead.
  if (target) {
    for (const neighbour of [previous, next]) {
      if (neighbour && neighbour.date !== target.date) {
        throw new ValidationError('Cannot reorder a stop relative to a stop on a different day')
      }
    }
  }

  const previousOrder = previous?.order
  const nextOrder = next?.order
  // Guards the order value actually read above, not just "the neighbour still
  // exists" - closes the gap where two concurrent reorders into the same gap
  // (e.g. two tabs, or a retried request) could otherwise both compute and
  // write the same midpoint, silently colliding instead of one of them
  // failing and being retried against the now-current layout.
  const guards: OrderGuard[] = [
    ...(previous ? [{ stopId: previous.stopId, order: previousOrder! }] : []),
    ...(next ? [{ stopId: next.stopId, order: nextOrder! }] : []),
  ]

  if (previousOrder !== undefined && nextOrder !== undefined) {
    const midpoint = (previousOrder + nextOrder) / 2
    if (!(previousOrder < midpoint && midpoint < nextOrder)) {
      throw new ValidationError('No space left between these two stops - move it next to a different stop first')
    }
    return { order: midpoint, target, guards }
  }

  if (previousOrder !== undefined) {
    // previousOrder + ORDER_GAP alone can collide with a stop created later:
    // createStop's order comes from an independent per-day counter
    // (orderCounter.ts) that has no idea a "move to end" happened, so it can
    // hand out a value this move has already passed. Folding in a fresh
    // getNextOrder() call keeps this move in sync with that counter, so the
    // result is guaranteed ahead of every order value assigned so far by
    // either path, not just this specific previousOrder.
    const freshOrder = await getNextOrder(tripId, target?.date ?? previous!.date, client)
    return { order: Math.max(freshOrder, previousOrder + ORDER_GAP), target, guards }
  }

  // nextOrder must be defined here - validateUpdateStopInput already rejected
  // the case where neither previousStopId nor nextStopId was given.
  return { order: nextOrder! - ORDER_GAP, target, guards }
}

export async function updateStop(
  tripId: string,
  stopId: string,
  input: UpdateStopInput,
  client: DynamoDBDocumentClient = docClient,
  geoPlaces: GeoPlacesClient = placesClient,
): Promise<Stop | undefined> {
  if (!validateUpdateStopInput(input)) {
    throw new ValidationError('Invalid stop update input')
  }

  if (input.previousStopId === stopId || input.nextStopId === stopId) {
    throw new ValidationError('A stop cannot be reordered relative to itself')
  }

  const hasReorder = input.previousStopId !== undefined || input.nextStopId !== undefined
  const reorder = hasReorder ? await computeReorderedPosition(tripId, stopId, input, client) : undefined

  const schedule = input.time !== undefined || input.visitDurationMinutes !== undefined
    ? await readSchedule(tripId, client) : undefined
  const existing = schedule?.stops.find((stop) => stop.stopId === stopId)
  if (schedule) {
    if (!existing) return undefined
    assertNoOverlap({ ...existing, time: input.time ?? existing.time,
      visitDurationMinutes: input.visitDurationMinutes ?? existing.visitDurationMinutes }, schedule.stops, stopId)
  }

  const setParts: string[] = []
  const removeParts: string[] = []
  const expressionAttributeNames: Record<string, string> = {}
  const expressionAttributeValues: Record<string, unknown> = {}

  if (reorder !== undefined) {
    setParts.push('#order = :order')
    expressionAttributeNames['#order'] = 'order'
    expressionAttributeValues[':order'] = reorder.order
  }

  if (input.time !== undefined) {
    expressionAttributeNames['#time'] = 'time'
    if (input.time) {
      setParts.push('#time = :time')
      expressionAttributeValues[':time'] = input.time
    } else {
      removeParts.push('#time')
    }
  }

  if (input.notes !== undefined) {
    expressionAttributeNames['#notes'] = 'notes'
    const trimmedNotes = input.notes.trim()
    if (trimmedNotes) {
      setParts.push('#notes = :notes')
      expressionAttributeValues[':notes'] = trimmedNotes
    } else {
      removeParts.push('#notes')
    }
  }

  for (const field of ['category', 'visitDurationMinutes', 'address'] as const) {
    const raw = input[field]
    if (raw === undefined) continue
    const value = typeof raw === 'string' ? raw.trim() : raw
    expressionAttributeNames[`#${field}`] = field
    if (value === '') {
      removeParts.push(`#${field}`)
    } else {
      setParts.push(`#${field} = :${field}`)
      expressionAttributeValues[`:${field}`] = value
    }
  }

  const place = input.placeId !== undefined ? await getPlaceDetails(input.placeId, geoPlaces) : undefined
  const placeFields: Record<string, unknown> = place
    ? { placeId: place.placeId, placeName: place.name, location: place.location,
      ...(input.address === undefined ? { address: place.address } : {}) }
    : {}
  if (input.address !== undefined) {
    const address = input.address.trim()
    placeFields.location = !address ? undefined
      : place && address === place.address?.trim() ? place.location
        : await geocodeAddress(address, geoPlaces)
  }
  for (const [field, value] of Object.entries(placeFields)) {
    expressionAttributeNames[`#${field}`] = field
    if (value === undefined) {
      removeParts.push(`#${field}`)
    } else {
      setParts.push(`#${field} = :${field}`)
      expressionAttributeValues[`:${field}`] = value
    }
  }

  const updateExpression = [
    setParts.length > 0 ? `SET ${setParts.join(', ')}` : null,
    removeParts.length > 0 ? `REMOVE ${removeParts.join(', ')}` : null,
  ].filter(Boolean).join(' ')

  // A guard's own ConditionCheck fails here just like the main update's does
  // (attribute_exists(stopId)) if the stop it targets was deleted concurrently -
  // getNeighbour's earlier read only proves it existed a moment ago.
  const orderGuardItems = (reorder?.guards ?? []).map((guard) => ({
    ConditionCheck: {
      TableName: STOP_TABLE,
      Key: { tripId, stopId: guard.stopId },
      ConditionExpression: 'attribute_exists(stopId) AND #order = :expectedOrder',
      ExpressionAttributeNames: { '#order': 'order' },
      ExpressionAttributeValues: { ':expectedOrder': guard.order },
    },
  }))
  const scheduleItems = schedule ? [scheduleRevisionWrite(tripId, schedule.revision)] : []
  // Guard items (if any) always come before the main update, which stays
  // last - the catch block below relies on that position to tell "this stop
  // itself is gone" (the main update's own condition) apart from "a guard
  // failed" (someone else's concurrent change), rather than reporting every
  // transaction failure as the same generic error.
  const guardItems = [...scheduleItems, ...orderGuardItems]

  try {
    const update = {
      TableName: STOP_TABLE,
      Key: { tripId, stopId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
      ConditionExpression: 'attribute_exists(stopId)',
    }
    if (guardItems.length > 0) {
      await client.send(new TransactWriteCommand({ TransactItems: [...guardItems, { Update: update }] }))
      const saved: Record<string, unknown> = { ...(existing ?? reorder?.target) }
      for (const field of Object.values(expressionAttributeNames)) {
        if (Object.hasOwn(expressionAttributeValues, `:${field}`)) saved[field] = expressionAttributeValues[`:${field}`]
        else delete saved[field]
      }
      return saved as Stop
    }
    const result = await client.send(new UpdateCommand({ ...update, ReturnValues: 'ALL_NEW' }))
    return result.Attributes as Stop
  } catch (error) {
    if (error instanceof Error && error.name === 'TransactionCanceledException') {
      const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] }).CancellationReasons
      const mainUpdateFailed = reasons?.at(-1)?.Code === 'ConditionalCheckFailed'
      if (mainUpdateFailed) {
        return undefined
      }
      const scheduleFailed = schedule && reasons?.[0]?.Code === 'ConditionalCheckFailed'
      throw new ValidationError(
        scheduleFailed
          ? 'The schedule changed. Reload the itinerary and try again.'
          : 'This stop\'s position changed. Reload the itinerary and try again.',
      )
    }
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return undefined
    }
    throw error
  }
}
