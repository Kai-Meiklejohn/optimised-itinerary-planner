import { describe, expect, it } from 'vitest'

import type { ItineraryProject } from '@/itinerary'
import {
  amazonPositionToCoordinates,
  getDayMapStyle,
  getMarkerBounds,
  isValidCoordinates,
  projectItineraryMarkers,
  projectMarkerPositions,
} from './itinerary-map-model'

const project: ItineraryProject = {
  id: 1,
  name: 'Mapped trip',
  destination: 'Aotearoa New Zealand',
  startDate: '2027-01-01',
  endDate: '2027-01-02',
  collaborators: 1,
  accent: 'from-emerald-700 to-emerald-400',
  days: [
    {
      id: 'day-one',
      date: '2027-01-01',
      activities: [
        {
          id: 11,
          name: 'Morning lookout',
          category: 'Attraction',
          time: '09:00',
          duration: '1 hr',
          address: 'Lookout Road',
          location: { lat: -36.849, lng: 174.762 },
        },
        {
          id: 12,
          name: 'Manual lunch',
          category: 'Food',
          time: '12:00',
          duration: '1 hr',
          address: 'Address to be confirmed',
        },
        {
          id: 13,
          name: 'Evening harbour',
          category: 'Attraction',
          time: '18:00',
          duration: '1 hr',
          address: 'Harbour Road',
          location: { lat: -36.84, lng: 174.77 },
        },
      ],
    },
    {
      id: 'day-two',
      date: '2027-01-02',
      activities: [
        {
          id: 21,
          name: 'Second-day stop',
          category: 'Other',
          time: '10:00',
          duration: '2 hr',
          address: 'Another Road',
          location: { lat: -41.2865, lng: 174.7762 },
        },
      ],
    },
  ],
}

describe('itinerary map model', () => {
  it('validates provider-neutral coordinates and converts AWS longitude/latitude order once', () => {
    expect(isValidCoordinates({ lat: -90, lng: -180 })).toBe(true)
    expect(isValidCoordinates({ lat: 90, lng: 180 })).toBe(true)
    expect(isValidCoordinates({ lat: 91, lng: 0 })).toBe(false)
    expect(isValidCoordinates({ lat: 0, lng: Number.NaN })).toBe(false)
    expect(amazonPositionToCoordinates([174.762, -36.849])).toEqual({ lat: -36.849, lng: 174.762 })
    expect(amazonPositionToCoordinates([181, 0])).toBeUndefined()
    expect(amazonPositionToCoordinates(undefined)).toBeUndefined()
  })

  it('projects only the selected day by default and excludes unmapped activities without renumbering them', () => {
    const markers = projectItineraryMarkers(project, { scope: 'day', selectedDayId: 'day-one' })

    expect(markers.map(({ activityId, stopIndex }) => ({ activityId, stopIndex }))).toEqual([
      { activityId: 11, stopIndex: 1 },
      { activityId: 13, stopIndex: 3 },
    ])
    expect(markers[0].title).toBe('Day 1, stop 1: Morning lookout')
    expect(markers[1].title).toBe('Day 1, stop 3: Evening harbour')
  })

  it('projects every mapped day for the trip scope while keeping day colours and stop numbers stable', () => {
    const dayMarkers = projectItineraryMarkers(project, { scope: 'day', selectedDayId: 'day-one' })
    const tripMarkers = projectItineraryMarkers(project, { scope: 'trip', selectedDayId: 'day-one' })

    expect(tripMarkers).toHaveLength(3)
    expect(tripMarkers[0]).toMatchObject({ stopIndex: 1, colour: dayMarkers[0].colour })
    expect(tripMarkers[1]).toMatchObject({ stopIndex: 3, colour: dayMarkers[1].colour })
    expect(tripMarkers[2]).toMatchObject({ dayId: 'day-two', dayIndex: 1, stopIndex: 1 })
    expect(tripMarkers[2].colour).not.toBe(tripMarkers[0].colour)
  })

  it('returns deterministic day colours with readable marker glyphs', () => {
    expect(getDayMapStyle(0)).toEqual(getDayMapStyle(0))
    expect(getDayMapStyle(0).colour).not.toBe(getDayMapStyle(1).colour)
    expect(getDayMapStyle(0).glyphColour).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('builds bounds for zero, one, and many markers', () => {
    const markers = projectItineraryMarkers(project, { scope: 'trip', selectedDayId: 'day-one' })

    expect(getMarkerBounds([])).toBeNull()
    expect(getMarkerBounds([markers[0]])).toEqual({
      northEast: markers[0].position,
      southWest: markers[0].position,
    })
    expect(getMarkerBounds(markers)).toEqual({
      northEast: { lat: -36.84, lng: 174.7762 },
      southWest: { lat: -41.2865, lng: 174.762 },
    })
  })

  it('projects real coordinates into a padded overview without changing marker identity', () => {
    const markers = projectItineraryMarkers(project, { scope: 'day', selectedDayId: 'day-one' })
    const positions = projectMarkerPositions(markers)

    expect(positions.map(({ key }) => key)).toEqual(markers.map(({ key }) => key))
    expect(positions.every(({ x, y }) => x >= 10 && x <= 90 && y >= 10 && y <= 90)).toBe(true)
    expect(projectMarkerPositions([markers[0]])[0]).toMatchObject({ x: 50, y: 50 })
  })
})
