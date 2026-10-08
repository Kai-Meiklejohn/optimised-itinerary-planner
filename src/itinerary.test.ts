import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ItineraryProject } from './itinerary'
import {
  updateItineraryDates,
  findActivityOverlap,
  createClientId,
  createItineraryDays,
  formatDateRange,
  getActivityEndTime,
  getProjectPlaceCount,
  getProjectStatus,
  getTravelLegKey,
  isOutOfTimeOrder,
  parseActivityDuration,
  withDayActivities,
} from './itinerary'

const activity = {
  id: 1,
  name: 'Test place',
  category: 'Attraction' as const,
  time: '10:00',
  duration: '1 hr',
  address: 'Test address',
  location: { lat: -37.787, lng: 175.281 },
}

const baseProject: ItineraryProject = {
  id: 1,
  name: 'Test trip',
  destination: 'Test destination',
  startDate: '2027-01-01',
  endDate: '2027-01-02',
  collaborators: 1,
  accent: 'from-emerald-700 to-emerald-400',
  days: [],
}

describe('activity scheduling', () => {
  it('calculates end times for minutes, decimal hours, and combined durations', () => {
    for (const duration of ['90 min', '1.5 hr', '1 hr 30 min']) {
      expect(parseActivityDuration(duration)).toBe(90)
      expect(getActivityEndTime({ time: '09:45', duration })).toEqual({ time: '11:15', dayOffset: 0 })
    }
    expect(getActivityEndTime({ time: '23:30', duration: '45 min' })).toEqual({ time: '00:15', dayOffset: 1 })
    expect(getActivityEndTime({ time: '23:00', duration: '1 hr' })).toEqual({ time: '00:00', dayOffset: 1 })
  })

  it('rejects unparseable or out-of-range durations and invalid start times', () => {
    for (const duration of ['', 'later', '0 min', '-1 hr', '1 hr junk', '25 hr']) {
      expect(parseActivityDuration(duration)).toBeNull()
      expect(getActivityEndTime({ time: '10:00', duration })).toBeNull()
    }
    expect(getActivityEndTime({ time: '24:00', duration: '1 hr' })).toBeNull()
  })
})

describe('createItineraryDays', () => {
  it('keeps the selected calendar dates unchanged in the local timezone', () => {
    vi.stubEnv('TZ', 'Pacific/Auckland')
    expect(new Date('2027-09-10T00:00:00').toISOString().slice(0, 10)).toBe('2027-09-09')

    expect(createItineraryDays('2027-09-10', '2027-09-12')).toEqual([
      { id: '2027-09-10', date: '2027-09-10', activities: [] },
      { id: '2027-09-11', date: '2027-09-11', activities: [] },
      { id: '2027-09-12', date: '2027-09-12', activities: [] },
    ])
  })

  it('creates one day when a trip starts and ends on the same date', () => {
    expect(createItineraryDays('2028-02-29', '2028-02-29')).toEqual([
      { id: '2028-02-29', date: '2028-02-29', activities: [] },
    ])
  })

  it('creates inclusive days across month boundaries', () => {
    expect(createItineraryDays('2027-10-31', '2027-11-02').map((day) => day.date)).toEqual([
      '2027-10-31',
      '2027-11-01',
      '2027-11-02',
    ])
  })

  it('returns no days for invalid or reversed ranges', () => {
    expect(createItineraryDays('not-a-date', '2027-11-02')).toEqual([])
    expect(createItineraryDays('2027-02-29', '2027-03-01')).toEqual([])
    expect(createItineraryDays('2027-02-31', '2027-03-03')).toEqual([])
    expect(createItineraryDays('10000-01-01', '10000-01-02')).toEqual([])
    expect(createItineraryDays('2027-11-03', '2027-11-02')).toEqual([])
  })

  it('supports canonical four-digit years without Date.UTC remapping', () => {
    expect(createItineraryDays('0001-01-01', '0001-01-02').map((day) => day.date)).toEqual([
      '0001-01-01',
      '0001-01-02',
    ])
  })

  it('defensively limits a trip to 60 days', () => {
    expect(createItineraryDays('2027-01-01', '2027-03-01')).toHaveLength(60)
    expect(createItineraryDays('2027-01-01', '2027-03-02')).toEqual([])
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('itinerary display helpers', () => {
  it('keeps only travel choices for consecutive pairs after insertion or removal', () => {
    const activities = [activity, { ...activity, id: 2 }, { ...activity, id: 3 }]
    const day = {
      id: 'one', date: '2027-01-01', activities,
      travel: {
        [getTravelLegKey(1, 2)]: { mode: 'flying' as const, minutes: 90 },
        [getTravelLegKey(2, 3)]: { mode: 'walking' as const },
      },
    }
    expect(withDayActivities(day, [activities[0], { ...activity, id: 4 }, ...activities.slice(1)]).travel)
      .toEqual({ '2:3': { mode: 'walking' } })
    expect(withDayActivities(day, [activities[0], activities[2]]).travel).toEqual({})
    expect(withDayActivities(day, []).travel).toEqual({})
    expect(withDayActivities(day, [activity]).travel).toEqual({})
    expect(day.travel['1:2']).toEqual({ mode: 'flying', minutes: 90 })
    expect(day.activities).toHaveLength(3)
  })

  it('flags a stop whose time is earlier than the one immediately before it', () => {
    const activities = [{ time: '19:00', duration: '1 hr' }, { time: '09:00', duration: '1 hr' }, { time: '20:00', duration: '1 hr' }]
    expect(isOutOfTimeOrder(activities, 0)).toBe(false)
    expect(isOutOfTimeOrder(activities, 1)).toBe(true)
    expect(isOutOfTimeOrder(activities, 2)).toBe(false)
  })

  it('does not flag a stop when either it or its predecessor has no time set', () => {
    expect(isOutOfTimeOrder([{ time: '', duration: '1 hr' }, { time: '09:00', duration: '1 hr' }], 1)).toBe(false)
    expect(isOutOfTimeOrder([{ time: '19:00', duration: '1 hr' }, { time: '', duration: '1 hr' }], 1)).toBe(false)
  })

  it('does not flag a stop whose early time is actually a correct continuation after the previous stop rolled past midnight', () => {
    // Previous stop runs 23:58 -> 00:58 "next day" - the next stop starting
    // at 01:30 is chronologically fine, not "earlier than the stop before it".
    const activities = [{ time: '23:58', duration: '1 hr' }, { time: '01:30', duration: '1 hr' }]
    expect(isOutOfTimeOrder(activities, 1)).toBe(false)
  })

  it('does not flag a stop well after a prior rollover, even though its HH:MM reads earlier than the previous stop\'s own start', () => {
    const activities = [{ time: '23:58', duration: '1 hr' }, { time: '05:00', duration: '1 hr' }]
    expect(isOutOfTimeOrder(activities, 1)).toBe(false)
  })

  it('still flags a stop that starts before the previous stop\'s rolled-over end actually finishes', () => {
    // Previous stop runs 23:58 -> 00:58 "next day". A stop starting at 00:00
    // reads as "after midnight" just like a genuine continuation would, but
    // it starts before the previous stop has even finished - comparing
    // against the previous stop's rolled-over END (not its raw start) is
    // what catches this.
    const activities = [{ time: '23:58', duration: '1 hr' }, { time: '00:00', duration: '1 hr' }]
    expect(isOutOfTimeOrder(activities, 1)).toBe(true)
  })

  it('formats a date range for display', () => {
    expect(formatDateRange('2027-09-10', '2027-09-12')).toBe('10 Sept 2027 - 12 Sept 2027')
  })

  it('totals activities across every day', () => {
    const project: ItineraryProject = {
      ...baseProject,
      days: [
        { id: 'one', date: '2027-01-01', activities: [activity, { ...activity, id: 2 }] },
        { id: 'two', date: '2027-01-02', activities: [{ ...activity, id: 3 }] },
      ],
    }

    expect(getProjectPlaceCount(project)).toBe(3)
  })

  it('derives planning status from whether the project has places', () => {
    const emptyProject: ItineraryProject = {
      ...baseProject,
      days: [{ id: 'one', date: '2027-01-01', activities: [] }],
    }
    const plannedProject: ItineraryProject = {
      ...baseProject,
      days: [{ id: 'one', date: '2027-01-01', activities: [activity] }],
    }

    expect(getProjectStatus(emptyProject)).toBe('Ready to plan')
    expect(getProjectStatus(plannedProject)).toBe('Planning')
  })

  it('creates monotonically increasing client IDs', () => {
    const firstId = createClientId()
    const secondId = createClientId()

    expect(secondId).toBeGreaterThan(firstId)
  })
})

describe('updateItineraryDates', () => {
  const day = { id: '2027-01-02', date: '2027-01-02', activities: [activity], travel: {} }
  const project = { ...baseProject, days: [{ id: '2027-01-01', date: '2027-01-01', activities: [] }, day] }
  it('keeps retained days intact and adds empty dates', () => {
    const updated = updateItineraryDates(project, '2027-01-02', '2027-01-03')
    expect(updated.days).toEqual([day, { id: '2027-01-03', date: '2027-01-03', activities: [] }])
    expect(updated.days[0]).toBe(day)
    expect(project.days).toHaveLength(2)
  })
  it.each([['', '2027-01-03'], ['2027-02-30', '2027-03-01'], ['2027-01-03', '2027-01-01'], ['2027-01-01', '2027-12-31']])('rejects invalid ranges %s to %s', (start, end) => {
    expect(() => updateItineraryDates(project, start, end)).toThrow(/1 to 60 days/)
  })
  it('refuses to discard occupied dates', () => {
    expect(() => updateItineraryDates(project, '2027-01-03', '2027-01-03')).toThrow(/Remove the places/)
  })
})


describe('activity overlap detection', () => {
  const days = [{ id: 'd1', date: '2027-01-01', activities: [{ ...activity, time: '23:30', duration: '1 hr' }] },
    { id: 'd2', date: '2027-01-02', activities: [{ ...activity, id: 2, name: 'Breakfast', time: '08:00' }] }]
  it.each(['23:30', '23:45', '23:00'])("rejects intersecting intervals starting at %s", (time) => {
    expect(findActivityOverlap(days, '2027-01-01', { time, duration: '1 hr' })?.id).toBe(1)
  })
  it('checks midnight in both directions and allows exact boundaries', () => {
    expect(findActivityOverlap(days, '2027-01-02', { time: '00:00', duration: '1 hr' })?.id).toBe(1)
    expect(findActivityOverlap(days, '2027-01-01', { time: '23:00', duration: '10 hr' }, 1)?.id).toBe(2)
    expect(findActivityOverlap(days, '2027-01-02', { time: '00:30', duration: '1 hr' })).toBeUndefined()
    expect(findActivityOverlap(days, '2027-01-01', { time: '22:30', duration: '1 hr' })).toBeUndefined()
  })
  it('excludes the edited activity, unrelated days and unscheduled intervals', () => {
    expect(findActivityOverlap(days, '2027-01-01', { time: '23:30', duration: '1 hr' }, 1)).toBeUndefined()
    expect(findActivityOverlap(days, '2027-01-03', { time: '08:00', duration: '24 hr' })).toBeUndefined()
    expect(findActivityOverlap(days, '2027-01-02', { time: '', duration: '1 hr' })).toBeUndefined()
  })
})
