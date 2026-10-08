import type { Coordinates, ItineraryProject } from '@/itinerary'

export type MapScope = 'day' | 'trip'

export type MapMarker = {
  key: string
  dayId: string
  dayIndex: number
  activityId: number
  stopIndex: number
  title: string
  colour: string
  glyphColour: string
  position: Coordinates
  kind: 'activity'
}

export type PreviewMapMarker = {
  key: 'place-search-preview'
  title: string
  colour: string
  glyphColour: string
  position: Coordinates
  kind: 'preview'
}

export type DisplayMapMarker = MapMarker | PreviewMapMarker

export type MarkerBounds = {
  southWest: Coordinates
  northEast: Coordinates
}

export type PositionedMapMarker<T extends DisplayMapMarker = DisplayMapMarker> = T & {
  x: number
  y: number
}

const dayColours = ['#166534', '#1d4ed8', '#9f1239', '#6d28d9', '#9a3412', '#0f766e', '#854d0e'] as const

function channelToLinear(channel: number) {
  const normalized = channel / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function getRelativeLuminance(colour: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour)

  if (!match) {
    return 0
  }

  const [, red, green, blue] = match
  return (
    0.2126 * channelToLinear(Number.parseInt(red, 16))
    + 0.7152 * channelToLinear(Number.parseInt(green, 16))
    + 0.0722 * channelToLinear(Number.parseInt(blue, 16))
  )
}

export function getDayMapStyle(dayIndex: number) {
  const normalizedIndex = Number.isFinite(dayIndex) ? Math.max(0, Math.floor(dayIndex)) : 0
  const colour = dayColours[normalizedIndex % dayColours.length]

  return {
    colour,
    glyphColour: getRelativeLuminance(colour) > 0.43 ? '#0f172a' : '#ffffff',
  }
}

export function isValidCoordinates(value: Coordinates | undefined): value is Coordinates {
  return Boolean(
    value
    && Number.isFinite(value.lat)
    && Number.isFinite(value.lng)
    && value.lat >= -90
    && value.lat <= 90
    && value.lng >= -180
    && value.lng <= 180,
  )
}

export function amazonPositionToCoordinates(position: readonly number[] | undefined): Coordinates | undefined {
  if (!position || position.length < 2) {
    return undefined
  }

  const coordinates = { lng: position[0], lat: position[1] }
  return isValidCoordinates(coordinates) ? coordinates : undefined
}

export function getActivityMapKey(dayId: string, activityId: number) {
  return `${dayId}:${activityId}`
}

export function projectItineraryMarkers(
  project: ItineraryProject,
  { scope, selectedDayId }: { scope: MapScope; selectedDayId: string },
): MapMarker[] {
  return project.days.flatMap((day, dayIndex) => {
    if (scope === 'day' && day.id !== selectedDayId) {
      return []
    }

    const style = getDayMapStyle(dayIndex)

    return day.activities.flatMap((activity, activityIndex) => {
      if (!isValidCoordinates(activity.location)) {
        return []
      }

      const stopIndex = activityIndex + 1
      return [{
        key: getActivityMapKey(day.id, activity.id),
        dayId: day.id,
        dayIndex,
        activityId: activity.id,
        stopIndex,
        title: `Day ${dayIndex + 1}, stop ${stopIndex}: ${activity.name}`,
        ...style,
        position: activity.location,
        kind: 'activity' as const,
      }]
    })
  })
}

export function getMarkerBounds(markers: readonly Pick<DisplayMapMarker, 'position'>[]): MarkerBounds | null {
  if (markers.length === 0) {
    return null
  }

  const latitudes = markers.map((marker) => marker.position.lat)
  const longitudes = markers.map((marker) => marker.position.lng)

  return {
    southWest: { lat: Math.min(...latitudes), lng: Math.min(...longitudes) },
    northEast: { lat: Math.max(...latitudes), lng: Math.max(...longitudes) },
  }
}

function projectValue(value: number, minimum: number, maximum: number) {
  if (minimum === maximum) {
    return 50
  }

  return 10 + ((value - minimum) / (maximum - minimum)) * 80
}

export function projectMarkerPositions<T extends DisplayMapMarker>(markers: readonly T[]): PositionedMapMarker<T>[] {
  const bounds = getMarkerBounds(markers)

  if (!bounds) {
    return []
  }

  return markers.map((marker) => ({
    ...marker,
    x: projectValue(marker.position.lng, bounds.southWest.lng, bounds.northEast.lng),
    y: 100 - projectValue(marker.position.lat, bounds.southWest.lat, bounds.northEast.lat),
  }))
}
