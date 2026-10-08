import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, Car, Footprints, Plane, TrainFront, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Coordinates, ItineraryActivity, TravelMode, TravelPreference } from '@/itinerary'
import { isValidCoordinates } from '@/map/itinerary-map-model'
import { RoutesRequestError } from './amazon-routes'
import type { GroundTravelMode, RoutesGateway } from './amazon-routes'

const modes = { driving: 'Driving', walking: 'Walking', transit: 'Public transport', flying: 'Flying', other: 'Other' }
const icons = { driving: Car, walking: Footprints, transit: TrainFront, flying: Plane, other: Waypoints }
const inputClass = 'h-9 min-w-0 rounded-lg border border-emerald-950/15 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-emerald-700/30'

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} hr${rest ? ` ${rest} min` : ''}` : `${rest} min`
}

function ManualTime({ preference, onChange }: { preference: TravelPreference; onChange: (value: TravelPreference) => void }) {
  const id = useId()
  const [draft, setDraft] = useState(String(preference.minutes ?? ''))
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const minutes = Number(draft)
    if (!draft.trim() || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      setError('Enter whole minutes from 1 to 10,080.')
      input.current?.focus()
      return
    }
    setError('')
    onChange({ mode: preference.mode, minutes })
  }
  return (
    <form className="mt-2 space-y-2" noValidate onSubmit={submit}>
      <p className="text-slate-500">Enter your flight or other journey duration; no automatic estimate is available.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={id}>Travel time in minutes</label>
        <input aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={Boolean(error)} className={`${inputClass} w-24`} id={id} min={1} max={10080} step={1} onChange={(event) => setDraft(event.target.value)} ref={input} type="number" value={draft} />
        <span id={`${id}-help`}>minutes (up to 7 days)</span>
        <Button size="sm" type="submit" variant="outline">Set time</Button>
        {preference.minutes !== undefined && <Button size="sm" type="button" variant="ghost" onClick={() => { setDraft(''); setError(''); onChange({ mode: preference.mode }) }}>Clear time</Button>}
      </div>
      {error && <p className="text-red-700" id={`${id}-error`} role="alert">{error}</p>}
      {preference.minutes !== undefined && <p className="font-medium text-emerald-800">Your estimate: {formatMinutes(preference.minutes)}</p>}
    </form>
  )
}

function RouteEstimate({ from, to, mode, gateway }: { from: Coordinates; to: Coordinates; mode: GroundTravelMode; gateway: RoutesGateway }) {
  const { lat: fromLat, lng: fromLng } = from
  const { lat: toLat, lng: toLng } = to
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ status: 'loading' | 'success' | 'error'; seconds?: number; error?: string }>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    setResult({ status: 'loading' })
    const timer = setTimeout(() => {
      controller.abort()
      setResult({ status: 'error', error: 'The estimate timed out. Try again.' })
    }, 15000)
    // Defer until after effect cleanup so StrictMode does not send duplicate requests.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      try {
        const value = await gateway.estimate({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, mode, controller.signal)
        if (!controller.signal.aborted) setResult({ status: 'success', seconds: value.durationSeconds })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ status: 'error', error: error instanceof RoutesRequestError ? error.message : 'Travel estimates are temporarily unavailable.' })
      } finally {
        clearTimeout(timer)
      }
    })
    return () => { controller.abort(); clearTimeout(timer) }
  }, [gateway, fromLat, fromLng, toLat, toLng, mode, attempt])

  return (
    <div className="mt-2 space-y-2">
      {result.status === 'loading' && <span role="status">Estimating…</span>}
      {result.status === 'success' && <span className="font-semibold text-emerald-800" role="status">{formatMinutes(Math.ceil(result.seconds! / 60))}</span>}
      {result.status === 'error' && <>
        <p className="text-red-700" role="alert">{result.error}</p>
        <Button onClick={() => setAttempt((value) => value + 1)} size="sm" type="button" variant="outline">Try again</Button>
      </>}
    </div>
  )
}

export function TravelLeg({ from, to, preference = { mode: 'driving' }, gateway, onChange }: {
  from: ItineraryActivity
  to: ItineraryActivity
  preference?: TravelPreference
  gateway: RoutesGateway | null
  onChange: (value: TravelPreference) => void
}) {
  const id = useId()
  const mode = preference.mode
  const Icon = icons[mode]
  const manual = mode === 'flying' || mode === 'other'
  return (
    <div aria-label={`Travel from ${from.name} to ${to.name}`} className="mx-4 border-l-2 border-emerald-800/15 py-1 pl-4 text-xs text-slate-600 sm:mx-5" role="group">
      <div className="flex flex-wrap items-center gap-2">
        <ArrowDown className="size-3.5 text-emerald-700" aria-hidden="true" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Travel to {to.name}</span>
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <label className="sr-only" htmlFor={id}>Transport from {from.name} to {to.name}</label>
        <select className={`${inputClass} max-w-full`} id={id} onChange={(event) => onChange({ mode: event.target.value as TravelMode })} value={mode}>
          {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {manual ? <ManualTime key={mode} preference={preference} onChange={onChange} />
        : !isValidCoordinates(from.location) || !isValidCoordinates(to.location) ? <p className="mt-2 text-slate-500">Both places need map coordinates for an estimate.</p>
          : !gateway ? <p className="mt-2 text-slate-500">Routing is not configured. A restricted routing key is needed for estimates.</p>
            : <RouteEstimate key={`${mode}:${from.location.lat}:${from.location.lng}:${to.location.lat}:${to.location.lng}`} from={from.location} to={to.location} mode={mode} gateway={gateway} />}
    </div>
  )
}
