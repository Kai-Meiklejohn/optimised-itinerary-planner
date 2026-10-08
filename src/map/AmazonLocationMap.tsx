import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPin, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { AmazonLocationConfig } from '@/location/amazon-location'
import { getLegacyMapStyleUrl } from '@/location/amazon-location'
import { getMarkerBounds } from './itinerary-map-model'
import type { DisplayMapMarker, MapMarker } from './itinerary-map-model'

type MapRuntimeOptions = {
  container: HTMLElement
  style: string
  center: [number, number]
  zoom: number
  validateStyle: boolean
  attributionControl: false | { compact?: boolean }
  cooperativeGestures: boolean
  dragRotate: boolean
  pitchWithRotate: boolean
  touchPitch: boolean
}

type MapCameraOptions = {
  center: [number, number]
  zoom: number
  duration: number
}

type MapBoundsOptions = {
  padding: number
  maxZoom: number
  duration: number
}

type MapRuntimeEvent = 'load' | 'error'

export type MapRuntimeMap = {
  native?: unknown
  addControl: (control: unknown, position?: string) => unknown
  easeTo: (options: MapCameraOptions) => unknown
  fitBounds: (bounds: [[number, number], [number, number]], options: MapBoundsOptions) => unknown
  on: (event: MapRuntimeEvent, handler: () => void) => unknown
  off: (event: MapRuntimeEvent, handler: () => void) => unknown
  remove: () => unknown
  resize: () => unknown
}

export type MapRuntimeMarker = {
  setLngLat: (position: [number, number]) => MapRuntimeMarker
  addTo: (map: MapRuntimeMap) => MapRuntimeMarker
  remove: () => unknown
}

export type MapRuntime = {
  createMap: (options: MapRuntimeOptions) => MapRuntimeMap
  createMarker: (element: HTMLElement) => MapRuntimeMarker
  createNavigationControl: () => unknown
}

const mapLibreRuntime: MapRuntime = {
  createMap(options) {
    const map = new maplibregl.Map(options)
    return {
      native: map,
      addControl: (control, position) => map.addControl(control as maplibregl.IControl, position as maplibregl.ControlPosition),
      easeTo: (camera) => map.easeTo(camera),
      fitBounds: (bounds, camera) => map.fitBounds(bounds, camera),
      on: (event, handler) => map.on(event, handler),
      off: (event, handler) => map.off(event, handler),
      remove: () => map.remove(),
      resize: () => map.resize(),
    }
  },
  createMarker(element) {
    const marker = new maplibregl.Marker({ anchor: 'bottom', element })
    const runtimeMarker: MapRuntimeMarker = {
      setLngLat(position) {
        marker.setLngLat(position)
        return runtimeMarker
      },
      addTo(map) {
        marker.addTo(map.native as maplibregl.Map)
        return runtimeMarker
      },
      remove: () => marker.remove(),
    }
    return runtimeMarker
  },
  createNavigationControl: () => new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
}

type AmazonLocationMapProps = {
  config: AmazonLocationConfig
  markers: readonly DisplayMapMarker[]
  selectedMarkerKey: string | null
  onMarkerActivate: (marker: MapMarker) => void
  onErrorChange?: (hasError: boolean) => void
  runtime?: MapRuntime
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function usesCooperativeGestures() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches
}

function createMarkerElement(
  marker: DisplayMapMarker,
  selectedMarkerKey: string | null,
  onMarkerActivate: (marker: MapMarker) => void,
) {
  const element = document.createElement(marker.kind === 'activity' ? 'button' : 'span')
  element.className = 'amazon-location-marker'
  element.setAttribute('aria-label', marker.title)
  element.title = marker.title
  element.style.backgroundColor = marker.colour
  element.style.color = marker.glyphColour

  if (marker.kind === 'activity') {
    const button = element as HTMLButtonElement
    button.type = 'button'
    button.textContent = String(marker.stopIndex)
    button.setAttribute('aria-pressed', marker.key === selectedMarkerKey ? 'true' : 'false')
    button.addEventListener('click', () => onMarkerActivate(marker))
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onMarkerActivate(marker)
    })
  } else {
    element.classList.add('amazon-location-marker--preview')
    element.setAttribute('role', 'img')
    element.textContent = '◆'
  }

  return element
}

export function AmazonLocationMap({
  config,
  markers,
  selectedMarkerKey,
  onMarkerActivate,
  onErrorChange,
  runtime = mapLibreRuntime,
}: AmazonLocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapRuntimeMap | null>(null)
  const loadedRef = useRef(false)
  const lastCameraSignatureRef = useRef<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [retrySequence, setRetrySequence] = useState(0)

  useEffect(() => {
    onErrorChange?.(hasError)
  }, [hasError, onErrorChange])

  useEffect(() => {
    if (!containerRef.current) return

    loadedRef.current = false
    lastCameraSignatureRef.current = null
    setIsLoading(true)
    setHasError(false)
    let map: MapRuntimeMap
    try {
      map = runtime.createMap({
        container: containerRef.current,
        style: getLegacyMapStyleUrl(config),
        center: [0, 20],
        zoom: 2,
        validateStyle: false,
        attributionControl: { compact: true },
        cooperativeGestures: usesCooperativeGestures(),
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      })
    } catch {
      setHasError(true)
      setIsLoading(false)
      return
    }
    const handleLoad = () => {
      loadedRef.current = true
      setIsLoading(false)
    }
    const handleError = () => {
      if (!loadedRef.current) {
        setHasError(true)
        setIsLoading(false)
      }
    }
    const handleResize = () => map.resize()

    mapRef.current = map
    map.addControl(runtime.createNavigationControl(), 'bottom-right')
    map.on('load', handleLoad)
    map.on('error', handleError)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      map.off('load', handleLoad)
      map.off('error', handleError)
      map.remove()
      mapRef.current = null
    }
  }, [config, retrySequence, runtime])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const mapMarkers = markers.map((marker) => runtime
      .createMarker(createMarkerElement(marker, selectedMarkerKey, onMarkerActivate))
      .setLngLat([marker.position.lng, marker.position.lat])
      .addTo(map))
    const duration = prefersReducedMotion() ? 0 : 450
    const cameraSignature = markers
      .map((marker) => `${marker.key}:${marker.position.lat}:${marker.position.lng}`)
      .join('|')
    const shouldUpdateCamera = cameraSignature !== lastCameraSignatureRef.current
    lastCameraSignatureRef.current = cameraSignature

    if (shouldUpdateCamera && markers.length === 1) {
      const [{ position }] = markers
      map.easeTo({ center: [position.lng, position.lat], zoom: 13, duration })
    } else if (shouldUpdateCamera && markers.length > 1) {
      const bounds = getMarkerBounds(markers)
      if (bounds) {
        map.fitBounds(
          [
            [bounds.southWest.lng, bounds.southWest.lat],
            [bounds.northEast.lng, bounds.northEast.lat],
          ],
          { padding: 80, maxZoom: 14, duration },
        )
      }
    }

    return () => {
      for (const marker of mapMarkers) marker.remove()
    }
  }, [markers, onMarkerActivate, retrySequence, runtime, selectedMarkerKey])

  return (
    <div className="absolute inset-0">
      <div aria-label="Road map" className="size-full" ref={containerRef} role="application" />

      {isLoading && !hasError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#e6ece3]/80">
          <p className="rounded-full bg-white px-4 py-2 text-xs font-medium text-emerald-800 shadow-sm">Loading map…</p>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#e6ece3] p-6 text-center">
          <div className="max-w-xs rounded-2xl bg-white/95 p-5 shadow-sm ring-1 ring-emerald-950/8">
            <MapPin className="mx-auto size-5 text-emerald-700" aria-hidden="true" />
            <h3 className="mt-3 font-semibold text-emerald-950">Map unavailable</h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              The itinerary is still available. Check the map configuration or try again.
            </p>
            <Button className="mt-4 rounded-xl" onClick={() => setRetrySequence((current) => current + 1)} size="sm" variant="outline">
              <RefreshCw data-icon="inline-start" />
              Retry map
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
