import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AmazonLocationConfig } from '@/location/amazon-location'
import { AmazonLocationMap } from './AmazonLocationMap'
import type { MapRuntime } from './AmazonLocationMap'
import type { DisplayMapMarker, MapMarker, PreviewMapMarker } from './itinerary-map-model'

const config: AmazonLocationConfig = {
  apiKey: 'test-public-key',
  region: 'us-east-1',
  mapName: 'itinerary-planner-map',
  placeIndexName: 'itinerary-planner-places',
}

const activityMarker: MapMarker = {
  key: 'day-1:101',
  dayId: 'day-1',
  dayIndex: 0,
  activityId: 101,
  stopIndex: 1,
  title: 'Day 1, stop 1: Museum',
  colour: '#166534',
  glyphColour: '#ffffff',
  position: { lat: -37.787, lng: 175.281 },
  kind: 'activity',
}

const previewMarker: PreviewMapMarker = {
  key: 'place-search-preview',
  title: 'Preview location: Garden',
  colour: '#f59e0b',
  glyphColour: '#422006',
  position: { lat: -37.79, lng: 175.29 },
  kind: 'preview',
}

function createRuntime() {
  const handlers = new Map<string, Set<() => void>>()
  const map = {
    addControl: vi.fn(),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      const listeners = handlers.get(event) ?? new Set()
      listeners.add(handler)
      handlers.set(event, listeners)
    }),
    off: vi.fn((event: string, handler: () => void) => handlers.get(event)?.delete(handler)),
    remove: vi.fn(),
    resize: vi.fn(),
  }
  const markerRecords: Array<{
    element: HTMLElement
    setLngLat: ReturnType<typeof vi.fn>
    addTo: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }> = []
  const runtime: MapRuntime = {
    createMap: vi.fn(() => map),
    createMarker: vi.fn((element) => {
      const marker = {
        element,
        setLngLat: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn(),
      }
      markerRecords.push(marker)
      return marker
    }),
    createNavigationControl: vi.fn(() => ({ control: true })),
  }
  return { handlers, map, markerRecords, runtime }
}

describe('AmazonLocationMap', () => {
  it('creates the basemap, accessible markers, bounds, activation, and cleanup', async () => {
    const user = userEvent.setup()
    const { map, markerRecords, runtime } = createRuntime()
    const onMarkerActivate = vi.fn()
    const markers: DisplayMapMarker[] = [activityMarker, previewMarker]
    const view = render(
      <AmazonLocationMap
        config={config}
        markers={markers}
        onMarkerActivate={onMarkerActivate}
        runtime={runtime}
        selectedMarkerKey={null}
      />,
    )

    await waitFor(() => expect(runtime.createMap).toHaveBeenCalledOnce())
    expect(runtime.createMap).toHaveBeenCalledWith(expect.objectContaining({
      style: 'https://maps.geo.us-east-1.amazonaws.com/maps/v0/maps/itinerary-planner-map/style-descriptor?key=test-public-key',
      validateStyle: false,
    }))
    expect(map.addControl).toHaveBeenCalledOnce()
    expect(markerRecords).toHaveLength(2)
    expect(markerRecords[0].setLngLat).toHaveBeenCalledWith([175.281, -37.787])
    expect(markerRecords[1].setLngLat).toHaveBeenCalledWith([175.29, -37.79])
    expect(map.fitBounds).toHaveBeenCalled()

    expect(markerRecords[0].element).toHaveAccessibleName('Day 1, stop 1: Museum')
    expect(markerRecords[1].element).toHaveAccessibleName('Preview location: Garden')
    expect(markerRecords[0].element.tagName).toBe('BUTTON')
    expect(markerRecords[1].element.tagName).toBe('SPAN')
    expect(markerRecords[1].element).toHaveAttribute('role', 'img')
    markerRecords[0].element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    markerRecords[0].element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
    await user.click(markerRecords[0].element)
    await user.click(markerRecords[1].element)
    expect(onMarkerActivate).toHaveBeenCalledTimes(3)
    expect(onMarkerActivate).toHaveBeenCalledWith(activityMarker)

    const fitCountBeforeSelection = map.fitBounds.mock.calls.length
    view.rerender(
      <AmazonLocationMap
        config={config}
        markers={markers}
        onMarkerActivate={onMarkerActivate}
        runtime={runtime}
        selectedMarkerKey={activityMarker.key}
      />,
    )
    expect(map.fitBounds).toHaveBeenCalledTimes(fitCountBeforeSelection)

    view.rerender(
      <AmazonLocationMap
        config={config}
        markers={[activityMarker]}
        onMarkerActivate={onMarkerActivate}
        runtime={runtime}
        selectedMarkerKey={activityMarker.key}
      />,
    )
    await waitFor(() => expect(markerRecords[0].remove).toHaveBeenCalled())
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [175.281, -37.787] }))

    view.unmount()
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('shows a retryable fallback when the map reports an initial error', async () => {
    const user = userEvent.setup()
    const { handlers, map, runtime } = createRuntime()
    render(
      <AmazonLocationMap
        config={config}
        markers={[activityMarker]}
        onMarkerActivate={vi.fn()}
        runtime={runtime}
        selectedMarkerKey={null}
      />,
    )

    act(() => {
      for (const handler of handlers.get('error') ?? []) handler()
    })

    expect(screen.getByRole('heading', { name: 'Map unavailable' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry map' }))
    await waitFor(() => expect(runtime.createMap).toHaveBeenCalledTimes(2))
    expect(map.remove).toHaveBeenCalledOnce()
  })

  it('keeps the itinerary usable when WebGL map construction fails', () => {
    const { runtime } = createRuntime()
    vi.mocked(runtime.createMap).mockImplementationOnce(() => {
      throw new Error('Failed to initialize WebGL')
    })

    render(
      <AmazonLocationMap
        config={config}
        markers={[activityMarker]}
        onMarkerActivate={vi.fn()}
        runtime={runtime}
        selectedMarkerKey={null}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Map unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry map' })).toBeInTheDocument()
  })
})
