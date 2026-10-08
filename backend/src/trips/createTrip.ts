import { randomUUID } from 'node:crypto'
import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, TRIP_TABLE } from '../lib/dynamo.js'
import { ValidationError } from '../lib/errors.js'
import { isValidCalendarDate } from '../lib/isValidCalendarDate.js'
import { MAX_TRIP_DAYS, MAX_TRIP_DESTINATION_LENGTH, MAX_TRIP_NAME_LENGTH } from '../lib/limits.js'

export type CreateTripInput = {
  userId: string
  name: string
  destination: string
  startDate: string
  endDate: string
}

export type Trip = CreateTripInput & {
  tripId: string
  createdAt: string
  updatedAt: string
}

export function validateCreateTripInput(input: Partial<CreateTripInput>): input is CreateTripInput {
  return (
    typeof input.userId === 'string' && input.userId.length > 0
    && typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= MAX_TRIP_NAME_LENGTH
    && typeof input.destination === 'string' && input.destination.trim().length > 0 && input.destination.length <= MAX_TRIP_DESTINATION_LENGTH
    && typeof input.startDate === 'string' && isValidCalendarDate(input.startDate)
    && typeof input.endDate === 'string' && isValidCalendarDate(input.endDate)
    && input.startDate <= input.endDate
    && (Date.parse(input.endDate) - Date.parse(input.startDate)) / 86400000 < MAX_TRIP_DAYS
  )
}

export async function createTrip(
  input: Partial<CreateTripInput>,
  client: DynamoDBDocumentClient = docClient,
): Promise<Trip> {
  if (!validateCreateTripInput(input)) {
    throw new ValidationError('Invalid trip input')
  }

  const now = new Date().toISOString()
  const trip: Trip = {
    userId: input.userId,
    startDate: input.startDate,
    endDate: input.endDate,
    name: input.name.trim(),
    destination: input.destination.trim(),
    tripId: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }

  await client.send(
    new PutCommand({
      TableName: TRIP_TABLE,
      Item: trip,
      ConditionExpression: 'attribute_not_exists(tripId)',
    }),
  )

  return trip
}
