import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { STOP_TABLE } from '../lib/dynamo.js'
import { ValidationError } from '../lib/errors.js'
import { isValidTime } from '../lib/isValidTime.js'
import { listStops } from './listStops.js'

type ScheduledStop = { stopId?: string; placeName?: string; date?: string; time?: string; visitDurationMinutes: number }
// Reserved metadata is excluded from stop lists and deleted with the trip, like
// the existing order counters. One revision covers midnight across adjacent days.
const scheduleKey = (tripId: string) => ({ tripId, stopId: '#order#schedule' })

export function assertNoOverlap(candidate: ScheduledStop, stops: ScheduledStop[], excludedId?: string) {
  const interval = (stop: ScheduledStop) => {
    if (!stop.date || !stop.time || !isValidTime(stop.time) || !Number.isFinite(stop.visitDurationMinutes)) return null
    const [hours, minutes] = stop.time.split(':').map(Number)
    const start = Date.parse(`${stop.date}T00:00:00Z`) / 60_000 + hours * 60 + minutes
    return { start, end: start + stop.visitDurationMinutes }
  }
  const proposed = interval(candidate)
  if (!proposed) return
  const conflict = stops.find((stop) => {
    if (excludedId !== undefined && stop.stopId === excludedId) return false
    const existing = interval(stop)
    return existing && proposed.start < existing.end && existing.start < proposed.end
  })
  if (conflict) throw new ValidationError(`This time overlaps with ${conflict.placeName ?? 'another activity'}. Choose another start time or duration.`)
}

export async function readSchedule(tripId: string, client: DynamoDBDocumentClient) {
  // Read the version first. Any concurrent scheduling write during the paginated
  // scan changes it, so the eventual transaction rejects this stale snapshot.
  const result = await client.send(new GetCommand({ TableName: STOP_TABLE, Key: scheduleKey(tripId), ConsistentRead: true }))
  return { revision: Number(result.Item?.revision ?? 0), stops: await listStops(tripId, client) }
}

export function scheduleRevisionWrite(tripId: string, revision: number) {
  return { Update: {
    TableName: STOP_TABLE,
    Key: scheduleKey(tripId),
    UpdateExpression: 'SET revision = :next',
    ConditionExpression: revision === 0 ? 'attribute_not_exists(revision)' : 'revision = :revision',
    ExpressionAttributeValues: { ':next': revision + 1, ...(revision ? { ':revision': revision } : {}) },
  } }
}
