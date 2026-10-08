import { Map, MapPin, Route } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'

import type { ItineraryProject } from '@/itinerary'
import type { AmazonLocationConfig, ResolvedPlace } from '@/location/amazon-location'
import {
  getDayMapStyle,
  projectItineraryMarkers,
  projectMarkerPositions,
} from '@/map/itinerary-map-model'
import type { DisplayMapMarker, MapMarker, MapScope, PreviewMapMarker } from '@/map/itinerary-map-model'

const AmazonLocationMap = lazy(() => import('@/map/AmazonLocationMap').then((module) => ({
  default: module.AmazonLocationMap,
})))

type ItineraryMapProps = {
  project: ItineraryProject
  selectedDayId: string
  scope: MapScope
  selectedMarkerKey: string | null
  previewPlace?: ResolvedPlace | null
  locationConfig?: AmazonLocationConfig | null
  onScopeChange: (scope: MapScope) => void
  onMarkerActivate: (marker: MapMarker) => void
}

export function ItineraryMap({
  project,
  selectedDayId,
  scope,
  selectedMarkerKey,
  previewPlace,
  locationConfig,
  onScopeChange,
  onMarkerActivate,
}: ItineraryMapProps) {
  const [mapHasError, setMapHasError] = useState(false)
  const markers = useMemo(
    () => projectItineraryMarkers(project, { scope, selectedDayId }),
    [project, scope, selectedDayId],
  )
  const previewMarker = useMemo<PreviewMapMarker | null>(() => previewPlace?.location ? ({
    key: 'place-search-preview',
    title: `Preview location: ${previewPlace.name}`,
    colour: '#f59e0b',
    glyphColour: '#422006',
    position: previewPlace.location,
    kind: 'preview',
  }) : null, [previewPlace])
  const displayMarkers = useMemo<DisplayMapMarker[]>(
    () => previewMarker ? [...markers, previewMarker] : markers,
    [markers, previewMarker],
  )
  const positionedMarkers = useMemo(() => projectMarkerPositions(displayMarkers), [displayMarkers])
  const visibleDays = scope === 'trip' ? project.days : project.days.filter((day) => day.id === selectedDayId)
  const visibleActivityCount = visibleDays.reduce((total, day) => total + day.activities.length, 0)
  const unmappedCount = visibleActivityCount - markers.length
  const visibleDayIndexes = [...new Set(markers.map((marker) => marker.dayIndex))]

  return (
    <section
      aria-label={locationConfig ? 'Itinerary map' : 'Itinerary coordinate overview'}
      className="relative min-h-96 overflow-hidden bg-[#e6ece3] lg:min-h-[calc(100dvh-4.5rem)]"
    >
      {locationConfig ? (
        <Suspense fallback={(
          <div className="absolute inset-0 flex items-center justify-center bg-[#e6ece3]">
            <p className="rounded-full bg-white px-4 py-2 text-xs font-medium text-emerald-800 shadow-sm">Loading map…</p>
          </div>
        )}>
          <AmazonLocationMap
            config={locationConfig}
            markers={displayMarkers}
            onErrorChange={setMapHasError}
            onMarkerActivate={onMarkerActivate}
            selectedMarkerKey={selectedMarkerKey}
          />
        </Suspense>
      ) : (
        <>
          <div className="map-coordinate-grid absolute inset-0" aria-hidden="true" />
          <div className="absolute inset-x-5 top-24 bottom-32 sm:top-20" aria-label="Mapped itinerary stops">
            {positionedMarkers.map((marker) => {
              const isSelected = marker.kind === 'activity' && marker.key === selectedMarkerKey
              const markerStyle = {
                backgroundColor: marker.colour,
                color: marker.glyphColour,
                left: `${marker.x}%`,
                top: `${marker.y}%`,
              }
              const markerClassName = 'map-marker absolute z-10 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold shadow-[0_7px_18px_rgba(24,61,47,0.28)] ring-2 ring-white'

              if (marker.kind === 'preview') {
                return (
                  <span
                    aria-label={marker.title}
                    className={`${markerClassName} pointer-events-none`}
                    key={marker.key}
                    role="img"
                    style={markerStyle}
                    title={marker.title}
                  >
                    <MapPin className="size-4" aria-hidden="true" />
                  </span>
                )
              }

              return (
                <button
                  aria-label={marker.title}
                  aria-pressed={isSelected}
                  className={`${markerClassName} transition hover:z-20 hover:scale-110 focus:z-20 focus:scale-110 focus:outline-none focus:ring-4 focus:ring-amber-300 aria-pressed:scale-110 aria-pressed:ring-4 aria-pressed:ring-amber-300`}
                  key={marker.key}
                  onClick={() => onMarkerActivate(marker)}
                  style={markerStyle}
                  title={marker.title}
                  type="button"
                >
                  {marker.stopIndex}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="absolute top-5 right-5 left-5 z-20 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 max-w-full items-center gap-2 rounded-xl bg-white/94 px-3 py-2 text-sm font-medium text-emerald-950 shadow-sm ring-1 ring-emerald-950/8 backdrop-blur">
          <Map className="size-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span className="truncate">{project.destination}</span>
        </div>

        <div aria-label="Map scope" className="flex rounded-xl bg-white/94 p-1 shadow-sm ring-1 ring-emerald-950/8 backdrop-blur">
          <button
            aria-pressed={scope === 'day'}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-emerald-800 aria-pressed:bg-emerald-800 aria-pressed:text-white"
            onClick={() => onScopeChange('day')}
            type="button"
          >
            This day
          </button>
          <button
            aria-pressed={scope === 'trip'}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-emerald-800 aria-pressed:bg-emerald-800 aria-pressed:text-white"
            onClick={() => onScopeChange('trip')}
            type="button"
          >
            Entire trip
          </button>
        </div>
      </div>

      {displayMarkers.length === 0 && !mapHasError && (
        <div className="absolute top-1/2 left-1/2 z-10 w-72 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white/90 p-5 text-center shadow-sm ring-1 ring-emerald-950/8 backdrop-blur">
          <MapPin className="mx-auto size-5 text-emerald-700" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-emerald-950">
            {scope === 'day' ? 'No mapped places for this day' : 'No mapped places for this trip'}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Manual places stay in the itinerary and can receive coordinates through place search.
          </p>
        </div>
      )}

      {scope === 'trip' && visibleDayIndexes.length > 0 && (
        <div aria-label="Map legend" className="absolute bottom-32 left-5 z-20 flex max-w-[calc(100%-2.5rem)] flex-wrap gap-2 sm:bottom-40">
          {visibleDayIndexes.map((dayIndex) => {
            const style = getDayMapStyle(dayIndex)
            return (
              <span className="flex items-center gap-1.5 rounded-full bg-white/94 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-emerald-950/8" key={dayIndex}>
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: style.colour }} />
                Day {dayIndex + 1}
              </span>
            )
          })}
        </div>
      )}

      <div className="absolute bottom-10 left-5 z-20 max-w-[calc(100%-6.5rem)] rounded-xl bg-white/94 px-3 py-2 shadow-[0_14px_35px_rgba(24,61,47,0.12)] ring-1 ring-emerald-950/8 backdrop-blur sm:bottom-8 sm:w-80 sm:max-w-none sm:rounded-2xl sm:p-4">
        <div className="flex items-start gap-3">
          <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 sm:flex">
            <Route className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-950">
              {locationConfig ? 'Live itinerary map' : 'Coordinate overview'}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              <span>{markers.length} mapped {markers.length === 1 ? 'stop' : 'stops'}</span>
              {unmappedCount > 0 && <span> · {unmappedCount} {unmappedCount === 1 ? 'place' : 'places'} <strong className="font-medium">Not shown on map</strong></span>}
            </p>
            <p className="mt-1 hidden text-[11px] leading-4 text-slate-400 sm:block">
              {locationConfig
                ? 'Amazon Location provides the Esri road map and search coordinates. Travel estimates appear between stops; route lines are not shown.'
                : 'Pins use real coordinates. Configure Amazon Location to enable the road map and live search.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
