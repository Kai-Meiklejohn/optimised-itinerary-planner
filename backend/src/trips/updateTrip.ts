import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, TRIP_TABLE } from '../lib/dynamo.js'
import { ValidationError } from '../lib/errors.js'
import { MAX_TRIP_DAYS, MAX_TRIP_DESTINATION_LENGTH, MAX_TRIP_NAME_LENGTH } from '../lib/limits.js'
import { getTrip } from './getTrip.js'
import { listStops } from '../stops/listStops.js'
import { isValidCalendarDate } from '../lib/isValidCalendarDate.js'
import type { Trip } from './createTrip.js'

export type UpdateTripInput = {
  name?: string
  destination?: string
  startDate?: string
  endDate?: string
}

export function validateUpdateTripInput(input: UpdateTripInput): boolean {
  const hasName = input.name !== undefined
  const hasDestination = input.destination !== undefined

  const hasDates = input.startDate !== undefined || input.endDate !== undefined
  if (hasDates && (
    typeof input.startDate !== 'string' || !isValidCalendarDate(input.startDate)
    || typeof input.endDate !== 'string' || !isValidCalendarDate(input.endDate)
    || input.startDate > input.endDate
    || (Date.parse(input.endDate) - Date.parse(input.startDate)) / 86400000 >= MAX_TRIP_DAYS
  )) return false

  if (!hasName && !hasDestination && !hasDates) {
    return false
  }

  if (hasName && (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > MAX_TRIP_NAME_LENGTH)) {
    return false
  }

  if (hasDestination && (typeof input.destination !== 'string' || input.destination.trim().length === 0 || input.destination.length > MAX_TRIP_DESTINATION_LENGTH)) {
    return false
  }

  return true
}

export async function updateTrip(
  userId: string,
  tripId: string,
  input: UpdateTripInput,
  client: DynamoDBDocumentClient = docClient,
): Promise<Trip | undefined> {
  if (!validateUpdateTripInput(input)) {
    throw new ValidationError('Invalid trip update input')
  }

  if (input.startDate !== undefined && input.endDate !== undefined) {
    if (!await getTrip({ userId, tripId }, client)) return undefined
    const { startDate, endDate } = input
    const stops = await listStops(tripId, client)
    if (stops.some((stop) => !stop.date || stop.date < startDate || stop.date > endDate)) {
      throw new ValidationError('Remove the places on excluded days before changing the trip dates.')
    }
  }

  const updateParts = ['updatedAt = :updatedAt']
  const expressionAttributeValues: Record<string, unknown> = { ':updatedAt': new Date().toISOString() }
  const expressionAttributeNames: Record<string, string> = {}

  if (input.name !== undefined) {
    updateParts.push('#name = :name')
    expressionAttributeNames['#name'] = 'name'
    expressionAttributeValues[':name'] = input.name.trim()
  }

  if (input.destination !== undefined) {
    updateParts.push('destination = :destination')
    expressionAttributeValues[':destination'] = input.destination.trim()
  }

  if (input.startDate !== undefined) {
    updateParts.push('startDate = :startDate', 'endDate = :endDate')
    expressionAttributeValues[':startDate'] = input.startDate
    expressionAttributeValues[':endDate'] = input.endDate
  }

  try {
    const result = await client.send(
      new UpdateCommand({
        TableName: TRIP_TABLE,
        Key: { userId, tripId },
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(tripId)',
        ReturnValues: 'ALL_NEW',
      }),
    )

    return result.Attributes as Trip
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return undefined
    }
    throw error
  }
}
