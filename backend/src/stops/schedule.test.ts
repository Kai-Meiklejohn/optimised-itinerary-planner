import { beforeEach, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { assertNoOverlap, readSchedule, scheduleRevisionWrite } from './schedule.js'

const mock = mockClient(DynamoDBDocumentClient)
beforeEach(() => mock.reset())
const stops = [{ stopId: 'a', placeName: 'Late visit', date: '2027-01-01', time: '23:30', visitDurationMinutes: 60 }]
it.each(['23:00', '23:30', '23:59'])('rejects overlapping starts at %s', (time) => {
  expect(() => assertNoOverlap({ date: '2027-01-01', time, visitDurationMinutes: 60 }, stops)).toThrow('overlaps')
})
it('checks overnight intervals, containment and touching boundaries', () => {
  expect(() => assertNoOverlap({ date: '2027-01-02', time: '00:15', visitDurationMinutes: 60 }, stops)).toThrow('overlaps')
  expect(() => assertNoOverlap({ date: '2027-01-01', time: '23:00', visitDurationMinutes: 1440 }, stops)).toThrow('overlaps')
  expect(() => assertNoOverlap({ date: '2027-01-02', time: '00:30', visitDurationMinutes: 60 }, stops)).not.toThrow()
  expect(() => assertNoOverlap({ date: '2027-01-01', time: '22:30', visitDurationMinutes: 60 }, stops)).not.toThrow()
})
it('excludes the updated stop and unscheduled records', () => {
  expect(() => assertNoOverlap(stops[0], stops, 'a')).not.toThrow()
  expect(() => assertNoOverlap({ time: '23:30', visitDurationMinutes: 60 }, stops)).not.toThrow()
  expect(() => assertNoOverlap({ date: '2027-01-01', time: '', visitDurationMinutes: 60 }, stops)).not.toThrow()
})
it('reads the revision before every stop page with consistent reads', async () => {
  mock.on(GetCommand).resolves({ Item: { revision: 3 } })
  mock.on(QueryCommand).resolvesOnce({ Items: [], LastEvaluatedKey: { tripId: 't', stopId: 'p' } }).resolves({ Items: stops })
  const snapshot = await readSchedule('t', mock as unknown as DynamoDBDocumentClient)
  expect(snapshot.revision).toBe(3)
  expect(snapshot.stops).toHaveLength(1)
  expect(mock.calls().map((call) => ('ConsistentRead' in call.args[0].input && call.args[0].input.ConsistentRead))).toEqual([true, true, true])
  expect(() => assertNoOverlap({ date: '2027-01-02', time: '00:00', visitDurationMinutes: 60 }, snapshot.stops)).toThrow('overlaps')
})
it('guards both legacy and existing revisions when committing a schedule', () => {
  expect(scheduleRevisionWrite('t', 0).Update.ConditionExpression).toContain('attribute_not_exists')
  expect(scheduleRevisionWrite('t', 3).Update.ExpressionAttributeValues).toMatchObject({ ':revision': 3, ':next': 4 })
})
