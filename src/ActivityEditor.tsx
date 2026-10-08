import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { BedDouble, ChevronDown, Clock3, Coffee, GripVertical, MapPin, Navigation, Pencil, Plus, Trash2, TrainFront, TriangleAlert, X } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ActivityCategory, ItineraryActivity, ItineraryDay } from '@/itinerary'
import { createClientId, findActivityOverlap, getActivityEndTime, parseActivityDuration } from '@/itinerary'
import type { BackendStop } from '@/lib/backendApi'
import { createBackendStop, updateBackendStop } from '@/lib/backendApi'
import { withBackendPlaceDetails } from '@/location/backend-places'
import { PlaceSearchCombobox } from '@/location/PlaceSearchCombobox'
import type { PlacesGateway, ResolvedPlace } from '@/location/amazon-location'
import { isValidCoordinates } from '@/map/itinerary-map-model'

const fieldClassName =
  'h-11 w-full rounded-xl border border-emerald-950/12 bg-white px-3.5 text-sm text-emerald-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-700/45 focus:ring-3 focus:ring-emerald-700/10'

const MAX_NOTES_LENGTH = 2000
const MAX_ADDRESS_LENGTH = 300

const categoryDetails: Record<ActivityCategory, { icon: typeof MapPin; colour: string }> = {
  Attraction: { icon: MapPin, colour: 'bg-emerald-100 text-emerald-700' },
  Food: { icon: Coffee, colour: 'bg-amber-100 text-amber-800' },
  Stay: { icon: BedDouble, colour: 'bg-violet-100 text-violet-700' },
  Transport: { icon: TrainFront, colour: 'bg-sky-100 text-sky-700' },
  Other: { icon: Navigation, colour: 'bg-slate-100 text-slate-700' },
}

export function ActivityCard({
  activity,
  index,
  isOutOfTimeOrder,
  isSelected,
  isActionPending,
  cardRef,
  onRemove,
  onEdit,
}: {
  activity: ItineraryActivity
  index: number
  isOutOfTimeOrder: boolean
  isSelected: boolean
  isActionPending: boolean
  cardRef: (node: HTMLElement | null) => void
  onRemove: () => void
  onEdit: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: activity.id, disabled: isActionPending })
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }
  const details = categoryDetails[activity.category]
  const CategoryIcon = details.icon
  const endTime = getActivityEndTime(activity)

  return (
    <article
      aria-label={activity.name}
      className="group relative scroll-mt-24 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-emerald-950/8 transition hover:shadow-[0_10px_28px_rgba(24,61,47,0.08)] focus:outline-none focus:ring-3 focus:ring-amber-300 data-[selected=true]:ring-3 data-[selected=true]:ring-amber-300 sm:p-5"
      data-selected={isSelected ? 'true' : undefined}
      ref={(node) => {
        cardRef(node)
        setNodeRef(node)
      }}
      style={dragStyle}
      tabIndex={-1}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <button
          aria-label={`Reorder ${activity.name}`}
          className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-slate-400 opacity-70 transition hover:bg-slate-50 hover:text-slate-600 focus:opacity-100 group-hover:opacity-100 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
          disabled={isActionPending}
          type="button"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-xs font-semibold text-white">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold tracking-tight text-emerald-950">{activity.name}</h3>
              <p className="mt-1 truncate text-xs text-slate-500">{activity.address}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button aria-label={`Edit ${activity.name}`} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-30" disabled={isActionPending} onClick={onEdit} type="button">
                <Pencil className="size-3.5" aria-hidden="true" /> Edit
              </button>
              <button
                aria-label={`Remove ${activity.name}`}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 opacity-70 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                disabled={isActionPending}
                onClick={onRemove}
                type="button"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <Badge className={`${details.colour} border-0`} variant="secondary">
              <CategoryIcon data-icon="inline-start" />
              {activity.category}
            </Badge>
            <span className="flex flex-wrap items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-slate-600">
              <Clock3 className="size-3" aria-hidden="true" />
              <span className="sr-only">Start</span><time>{activity.time || 'Time not set'}</time>
              {endTime && <><span aria-hidden="true">–</span><span className="sr-only">End</span><time>{endTime.time}</time>{endTime.dayOffset > 0 && <span>(next day)</span>}</>}
            </span>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-slate-600">{activity.duration}</span>
            {!isValidCoordinates(activity.location) && (
              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">
                <MapPin className="size-3" aria-hidden="true" />
                Not shown on map
              </span>
            )}
          </div>
          {isOutOfTimeOrder && (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 ring-1 ring-amber-900/10" role="status">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              Scheduled earlier than the stop before it
            </p>
          )}
          <div className="mt-3 text-xs leading-5 text-slate-600">
            <p className="font-medium text-slate-500">Notes</p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{activity.notes || 'No notes'}</p>
          </div>
        </div>
      </div>
    </article>
  )
}

export function ActivityForm({
  backendTripId,
  days,
  isActionPending,
  userId,
  biasPosition,
  date,
  destination,
  gateway,
  previousActivity,
  activity,
  onSave,
  onCancel,
  onPreviewChange,
  onSubmittingChange,
}: {
  backendTripId?: string
  days: ItineraryDay[]
  isActionPending: boolean
  userId: string
  biasPosition?: { lat: number; lng: number }
  date: string
  destination: string
  gateway: PlacesGateway | null
  previousActivity?: ItineraryActivity
  activity?: ItineraryActivity
  onSave: (activity: ItineraryActivity) => void
  onCancel: () => void
  onPreviewChange: (place: ResolvedPlace | null) => void
  // Lets the parent disable its own navigation (day switching, leaving the
  // trip) while a save is in flight - this component's own isSubmitting only
  // gates its own Cancel/close buttons, which isn't enough on its own since
  // the parent has other ways to unmount this panel mid-save.
  onSubmittingChange: (isSubmitting: boolean) => void
}) {
  const [name, setName] = useState(activity?.name ?? '')
  const [category, setCategory] = useState<ActivityCategory>(activity?.category ?? 'Attraction')
  const previousEnd = previousActivity ? getActivityEndTime(previousActivity) : null
  const suggestedTime = previousActivity
    ? (previousEnd?.dayOffset === 0 ? previousEnd.time : '')
    : '10:00'
  const [enteredTime, setEnteredTime] = useState<string | null>(activity?.time ?? null)
  const time = enteredTime ?? suggestedTime
  const [duration, setDuration] = useState(activity?.duration ?? '1 hr')
  const [address, setAddress] = useState(activity?.address === 'Address to be confirmed' ? '' : activity?.address ?? '')
  const [notes, setNotes] = useState(activity?.notes ?? '')
  const [selectedPlace, setSelectedPlace] = useState<ResolvedPlace | null>(null)
  const resolvedGateway = useMemo(() => gateway && backendTripId
    ? withBackendPlaceDetails(gateway, backendTripId, destination) : gateway, [gateway, backendTripId, destination])
  const [isResolving, setIsResolving] = useState(false)
  const [selectionRequired, setSelectionRequired] = useState(false)
  const categoryRevision = useRef(0)
  const lookupCategoryRevision = useRef(0)
  const [changingPlace, setChangingPlace] = useState(!activity)
  const [nameError, setNameError] = useState('')
  const [durationError, setDurationError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const durationInputRef = useRef<HTMLInputElement | null>(null)
  const endTime = getActivityEndTime({ time, duration })
  const startTimeHint = previousEnd?.dayOffset
    ? 'The previous activity ends the next day. Choose that day, or enter a start time for this day.'
    : previousActivity && !previousEnd
      ? 'The previous end time is unavailable. Choose a start time.'
      : ''

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting || isResolving || isActionPending) {
      return
    }

    const trimmedName = name.trim()
    const trimmedDuration = duration.trim()
    const durationMinutes = trimmedDuration ? parseActivityDuration(trimmedDuration) : null
    const nextNameError = ((activity && changingPlace) || selectionRequired) && !selectedPlace ? 'Select a replacement place, or cancel the change.' : trimmedName ? '' : 'Enter a place name.'
    const nextDurationError = !trimmedDuration ? 'Enter a duration.'
      : durationMinutes === null
        ? 'Enter a duration from 1 min to 24 hr, such as 45 min, 1.5 hr, or 1 hr 30 min.'
        : ''

    setNameError(nextNameError)
    setDurationError(nextDurationError)
    setSubmitError('')

    if (nextNameError || nextDurationError) {
      if (nextNameError) {
        nameInputRef.current?.focus()
      } else {
        durationInputRef.current?.focus()
      }
      return
    }

    const conflict = findActivityOverlap(days, date, { time, duration: trimmedDuration }, activity?.id)
    if (conflict) {
      setSubmitError(`This time overlaps with ${conflict.name}. Choose another start time or duration.`)
      return
    }

    setIsSubmitting(true)
    onSubmittingChange(true)

    const trimmedAddress = address.trim()
    const originalAddress = activity?.address === 'Address to be confirmed' ? '' : activity?.address?.trim() ?? ''
    const addressChanged = trimmedAddress !== (selectedPlace?.address.trim() ?? originalAddress)
    let resolvedLocation = selectedPlace ? selectedPlace.location : activity?.location
    let backendStop: BackendStop | undefined
    try {
      if (backendTripId) {
        const updates = { category, time, visitDurationMinutes: durationMinutes!, address: address.trim(), notes: notes.trim() }
        if (activity?.backendStopId) {
          backendStop = await updateBackendStop(backendTripId, activity.backendStopId, userId, {
            ...updates,
            address: selectedPlace || trimmedAddress !== originalAddress ? trimmedAddress : undefined,
            ...(selectedPlace?.backendPlaceId ? { placeId: selectedPlace.backendPlaceId } : {}),
          })
        } else {
          backendStop = await createBackendStop(backendTripId, userId, {
            ...updates,
            placeId: selectedPlace?.backendPlaceId,
            query: trimmedName,
            destination,
            placeSelected: Boolean(selectedPlace),
            priority: 3,
            date,
          })
        }
      } else if (addressChanged) {
        resolvedLocation = undefined
        if (trimmedAddress && gateway) {
          const signal = AbortSignal.timeout(15_000)
          const place = await gateway.resolve({ id: trimmedAddress, text: trimmedAddress, categories: [] }, { signal })
          signal.throwIfAborted()
          resolvedLocation = place.location
        }
      }
      if (!trimmedAddress) resolvedLocation = undefined
      if (backendStop) resolvedLocation = backendStop.location
    } catch (error) {
      console.error('Could not save the activity:', error)
      setIsSubmitting(false)
      onSubmittingChange(false)
      setSubmitError('Could not save this place. Please try again.')
      return
    }

    setIsSubmitting(false)
    onSubmittingChange(false)

    const id = activity?.id ?? createClientId()
    onSave({
      id,
      name: backendStop?.placeName ?? trimmedName,
      category: backendStop?.category ?? category,
      time,
      duration: trimmedDuration,
      address: address.trim() || 'Address to be confirmed',
      backendStopId: backendStop?.stopId ?? activity?.backendStopId,
      ...(resolvedLocation ? { location: resolvedLocation } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(selectedPlace?.placeId ? {
        place: {
          provider: selectedPlace.provider,
          placeId: selectedPlace.placeId,
          region: selectedPlace.region,
        },
      } : {}),
    })
  }

  return (
    <Card className="border-0 bg-[#fbfcf9] py-0 shadow-sm ring-1 ring-emerald-800/15" id="add-place-panel">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-emerald-950">{activity ? 'Edit place' : 'Add a place'}</h3>
            <p className="mt-1 text-xs text-slate-500">{activity ? 'Review the details and save your changes.' : 'Add the details you know now. They can be edited later.'}</p>
          </div>
          <button
            aria-label={activity ? 'Close edit place form' : 'Close add place form'}
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            disabled={isSubmitting || isActionPending}
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <form aria-label={activity ? 'Edit place' : 'Add place'} className="mt-5" onSubmit={handleSubmit}>
          <fieldset disabled={isSubmitting || isActionPending} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {(!changingPlace || selectedPlace) ? (
                <div>
                  <p className="text-xs font-medium text-slate-600">Place</p>
                  <p className="mt-1 font-medium">{name}</p>
                  <Button className="mt-2" disabled={!gateway} variant="outline" type="button" onClick={() => { setChangingPlace(true); setSelectedPlace(null); setName(''); setAddress(''); onPreviewChange(null) }}>Change place</Button>
                </div>
              ) : gateway ? (
                <PlaceSearchCombobox
                  biasPosition={biasPosition}
                  gateway={resolvedGateway!}
                  inputClassName={`${fieldClassName} pl-10 pr-10`}
                  inputDescribedBy={nameError ? 'place-name-error' : undefined}
                  inputInvalid={Boolean(nameError)}
                  inputRef={nameInputRef}
                  onResolvingChange={(resolving) => {
                    setIsResolving(resolving)
                    if (resolving) { lookupCategoryRevision.current = categoryRevision.current; setSelectionRequired(true) }
                  }}
                  onPlaceSelect={(place) => {
                    if (!place) setSelectionRequired(false)
                    setSelectedPlace(place)
                    onPreviewChange(place)
                    if (place) {
                      setName(place.name)
                      setAddress(place.address)
                      if (categoryRevision.current === lookupCategoryRevision.current) setCategory(place.category)
                      setNameError('')
                    }
                  }}
                  onValueChange={(value) => {
                    setName(value)
                    setNameError('')
                  }}
                  value={name}
                />
              ) : (
                <>
                  <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="place-name">
                    Place name
                  </label>
                  <div className="relative">
                    <MapPin className="absolute top-3.5 left-3.5 size-4 text-slate-400" aria-hidden="true" />
                    <input
                      autoFocus
                      className={`${fieldClassName} pl-10`}
                      id="place-name"
                      aria-describedby={nameError ? 'place-name-error' : undefined}
                      aria-invalid={nameError ? true : undefined}
                      onChange={(event) => {
                        setName(event.target.value)
                        setNameError('')
                      }}
                      placeholder="Enter a place"
                      ref={nameInputRef}
                      required
                      value={name}
                    />
                  </div>
                </>
              )}
              {nameError && (
                <p className="mt-2 text-xs text-red-700" id="place-name-error" role="alert">
                  {nameError}
                </p>
              )}
              {selectedPlace && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {selectedPlace.location ? 'Location selected and previewed on the map' : 'Place selected. No map coordinates available.'}
                </p>
              )}
              {!gateway && (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {activity ? 'Live search is not configured. You can still edit the other details.' : 'Live search is not configured. Enter the place details manually.'}
                </p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="place-category">
                Category
              </label>
              <div className="relative">
                <select
                  autoFocus={Boolean(activity)}
                  className={`${fieldClassName} appearance-none pr-9`}
                  id="place-category"
                  onChange={(event) => { categoryRevision.current += 1; setCategory(event.target.value as ActivityCategory) }}
                  value={category}
                >
                  {Object.keys(categoryDetails).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-3.5 right-3 size-4 text-slate-400" aria-hidden="true" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="place-time">
                Start time
              </label>
              <input
                className={fieldClassName}
                id="place-time"
                aria-describedby={startTimeHint ? 'place-time-hint' : undefined}
                onChange={(event) => setEnteredTime(event.target.value)}
                required={!activity}
                type="time"
                value={time}
              />
              {startTimeHint && <p className="mt-2 text-xs text-slate-500" id="place-time-hint">{startTimeHint}</p>}
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="place-duration">
                Duration
              </label>
              <input
                className={fieldClassName}
                id="place-duration"
                aria-describedby={durationError ? 'place-duration-error' : 'place-duration-hint'}
                aria-invalid={durationError ? true : undefined}
                onChange={(event) => {
                  setDuration(event.target.value)
                  setDurationError('')
                }}
                placeholder="1 hr"
                ref={durationInputRef}
                required
                value={duration}
              />
              <p className="mt-2 text-xs text-slate-500" id="place-duration-hint">For example: 45 min, 1.5 hr, or 1 hr 30 min. Maximum 24 hr.</p>
              {endTime && <p className="mt-2 text-xs font-medium text-emerald-700" aria-live="polite">Ends at {endTime.time}{endTime.dayOffset > 0 ? ' (next day)' : ''}</p>}
              {durationError && (
                <p className="mt-2 text-xs text-red-700" id="place-duration-error" role="alert">
                  {durationError}
                </p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="place-address">
                Address <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                className={fieldClassName}
                id="place-address"
                aria-describedby="place-address-hint"
                maxLength={MAX_ADDRESS_LENGTH}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Street or neighbourhood"
                value={address}
              />
              <p className="mt-2 text-xs text-slate-500" id="place-address-hint">Changing the address updates the pin when saved. Clearing it removes the pin. Unresolved addresses are not shown on the map.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="place-notes">
                Notes <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                className={`${fieldClassName} h-auto resize-y py-3`}
                id="place-notes"
                maxLength={MAX_NOTES_LENGTH}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Tickets, meeting points, or anything to remember"
                rows={3}
                value={notes}
              />
            </div>
            {submitError && (
              <p className="rounded-xl bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700 ring-1 ring-red-700/10 sm:col-span-2" role="alert">
                {submitError}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:col-span-2 sm:flex-row sm:justify-end">
              <Button className="rounded-xl" disabled={isSubmitting || isActionPending} onClick={onCancel} type="button" variant="outline">
                Cancel
              </Button>
              <Button className="rounded-xl" disabled={isSubmitting || isActionPending || isResolving} type="submit">
                {activity ? <Pencil data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                {isSubmitting ? (activity ? 'Saving…' : 'Adding…') : activity ? 'Save changes' : 'Add to day'}
              </Button>
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}
