import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  MapPin,
  Pencil,
  Plus,
  Route,
  Trash2,
  X,
} from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { NewItineraryProject, ItineraryActivity, ItineraryProject, TravelPreference } from '@/itinerary'
import { updateItineraryDates, formatDateRange, getProjectPlaceCount, getProjectStatus, getTravelLegKey, isOutOfTimeOrder, withDayActivities } from '@/itinerary'
import { deleteBackendStop, updateBackendStop } from '@/lib/backendApi'
import { ActivityCard, ActivityForm } from '@/ActivityEditor'
import {
  createAmazonLocationPlacesGateway,
  getAmazonLocationConfig,
} from '@/location/amazon-location'
import type {
  AmazonLocationConfig,
  PlacesGateway,
  ResolvedPlace,
} from '@/location/amazon-location'
import { ItineraryMap } from '@/map/ItineraryMap'
import { getActivityMapKey, isValidCoordinates } from '@/map/itinerary-map-model'
import type { MapMarker, MapScope } from '@/map/itinerary-map-model'
import { cacheRoutesGateway } from '@/travel/cached-routes'
import { TravelLeg } from '@/travel/TravelLeg'
import { createAmazonRoutesGateway, getAmazonRoutesConfig } from '@/travel/amazon-routes'
import type { RoutesGateway } from '@/travel/amazon-routes'

const fieldClassName =
  'h-11 w-full rounded-xl border border-emerald-950/12 bg-white px-3.5 text-sm text-emerald-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-700/45 focus:ring-3 focus:ring-emerald-700/10'

function getDayLabel(date: string, index: number) {
  return {
    day: `Day ${index + 1}`,
    date: new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(`${date}T00:00:00`),
    ),
  }
}

function BrandIcon() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-800 text-white shadow-sm">
      <Route className="size-4" aria-hidden="true" />
    </span>
  )
}

function PlannerHeader({
  project,
  onBack,
  onEdit,
  onDelete,
  isBackDisabled,
}: {
  project: ItineraryProject
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  isBackDisabled: boolean
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-emerald-950/8 bg-white/95 backdrop-blur">
      <div className="flex h-18 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button aria-label="Back to itineraries" className="rounded-xl" disabled={isBackDisabled} onClick={onBack} size="icon" variant="outline">
            <ArrowLeft />
          </Button>
          <BrandIcon />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold sm:text-base">{project.name}</h1>
            <p className="truncate text-xs text-slate-500">{project.destination}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button aria-label="Edit trip details" className="rounded-xl" disabled={isBackDisabled} onClick={onEdit} size="icon" variant="outline">
            <Pencil />
          </Button>
          <Button aria-label="Delete trip" className="rounded-xl" disabled={isBackDisabled} onClick={onDelete} size="icon" variant="outline">
            <Trash2 />
          </Button>
          <Button className="rounded-xl" disabled size="sm" variant="outline">
            Share
          </Button>
        </div>
      </div>
    </header>
  )
}

function EditTripPanel({
  project,
  isSaving,
  onSave,
  onCancel,
}: {
  project: ItineraryProject
  isSaving?: boolean
  onSave: (updates: NewItineraryProject) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(project.name)
  const [destination, setDestination] = useState(project.destination)
  const [startDate, setStartDate] = useState(project.startDate)
  const [endDate, setEndDate] = useState(project.endDate)
  const [dateError, setDateError] = useState('')
  const [nameError, setNameError] = useState('')
  const [destinationError, setDestinationError] = useState('')
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const destinationInputRef = useRef<HTMLInputElement | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving) return
    const trimmedName = name.trim()
    const trimmedDestination = destination.trim()
    const nextNameError = trimmedName ? '' : 'Enter a trip name.'
    const nextDestinationError = trimmedDestination ? '' : 'Enter a destination.'

    setNameError(nextNameError)
    setDestinationError(nextDestinationError)

    if (nextNameError || nextDestinationError) {
      if (nextNameError) {
        nameInputRef.current?.focus()
      } else {
        destinationInputRef.current?.focus()
      }
      return
    }

    try {
      updateItineraryDates(project, startDate, endDate)
    } catch (error) {
      setDateError((error as Error).message)
      return
    }
    setDateError('')
    onSave({ name: trimmedName, destination: trimmedDestination, startDate, endDate })
  }

  return (
    <div className="border-b border-emerald-950/8 bg-white/95 px-4 py-5 sm:px-6">
      <Card className="mx-auto max-w-xl border-0 bg-[#fbfcf9] py-0 shadow-sm ring-1 ring-emerald-800/15">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-emerald-950">Edit trip details</h3>
              <p className="mt-1 text-xs text-slate-500">Update the trip name, destination or dates. Places stay on their existing dates.</p>
            </div>
            <button
              aria-label="Close edit trip form"
              disabled={isSaving}
              className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={onCancel}
              type="button"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <form aria-label="Edit trip" className="mt-5 grid gap-4" noValidate onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="edit-trip-name">
                Trip name
              </label>
              <input
                autoFocus
                className={fieldClassName}
                id="edit-trip-name"
                aria-describedby={nameError ? 'edit-trip-name-error' : undefined}
                aria-invalid={nameError ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value)
                  setNameError('')
                }}
                ref={nameInputRef}
                required
                value={name}
              />
              {nameError && (
                <p className="mt-2 text-xs text-red-700" id="edit-trip-name-error" role="alert">
                  {nameError}
                </p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="edit-trip-destination">
                Main destination
              </label>
              <input
                className={fieldClassName}
                id="edit-trip-destination"
                aria-describedby={destinationError ? 'edit-trip-destination-error' : undefined}
                aria-invalid={destinationError ? true : undefined}
                onChange={(event) => {
                  setDestination(event.target.value)
                  setDestinationError('')
                }}
                ref={destinationInputRef}
                required
                value={destination}
              />
              {destinationError && (
                <p className="mt-2 text-xs text-red-700" id="edit-trip-destination-error" role="alert">
                  {destinationError}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="edit-start-date">Start date</label>
                <input
                  className={fieldClassName} id="edit-start-date" type="date" required
                  disabled={isSaving} value={startDate}
                  onChange={(event) => { setStartDate(event.target.value); setDateError('') }}
                  aria-invalid={Boolean(dateError)} aria-describedby={dateError ? 'edit-date-error' : undefined}
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="edit-end-date">End date</label>
                <input
                  className={fieldClassName} id="edit-end-date" type="date" required
                  disabled={isSaving} value={endDate}
                  onChange={(event) => { setEndDate(event.target.value); setDateError('') }}
                  aria-invalid={Boolean(dateError)} aria-describedby={dateError ? 'edit-date-error' : undefined}
                />
              </div>
            </div>
            {dateError && <p id="edit-date-error" role="alert" className="text-xs text-red-700">{dateError}</p>}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button className="rounded-xl" disabled={isSaving} onClick={onCancel} type="button" variant="outline">
                Cancel
              </Button>
              <Button className="rounded-xl" disabled={isSaving} type="submit">
                {isSaving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function DeleteTripConfirm({
  isDeleting,
  onConfirm,
  onCancel,
}: {
  isDeleting?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="border-b border-red-900/10 bg-red-50 px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-red-900">Delete this trip and all its places? This can&apos;t be undone.</p>
        <div className="flex shrink-0 gap-2">
          <Button className="rounded-xl" disabled={isDeleting} onClick={onCancel} size="sm" type="button" variant="outline">
            Cancel
          </Button>
          <Button className="rounded-xl" disabled={isDeleting} onClick={onConfirm} size="sm" type="button" variant="destructive">
            <Trash2 data-icon="inline-start" />
            {isDeleting ? 'Deleting…' : 'Confirm delete'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ItineraryPlanner({
  project,
  userId,
  onBack,
  onChange,
  onEdit,
  onDelete,
  locationConfig: providedLocationConfig,
  placesGateway: providedPlacesGateway,
  routesGateway: providedRoutesGateway,
}: {
  project: ItineraryProject
  userId: string
  onBack: () => void
  onChange: (projectId: number, update: (project: ItineraryProject) => ItineraryProject) => void
  onEdit: (updates: NewItineraryProject) => Promise<boolean>
  onDelete: () => Promise<boolean>
  locationConfig?: AmazonLocationConfig | null
  placesGateway?: PlacesGateway | null
  routesGateway?: RoutesGateway | null
}) {
  const [selectedDayId, setSelectedDayId] = useState(project.days[0]?.id ?? '')
  const [showAddPlace, setShowAddPlace] = useState(false)
  const [editingActivity, setEditingActivity] = useState<ItineraryActivity | undefined>()
  const [isEditingTrip, setIsEditingTrip] = useState(false)
  const [isSavingTrip, setIsSavingTrip] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isDeletingTrip, setIsDeletingTrip] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isStopActionPending, setIsStopActionPending] = useState(false)
  const [mapScope, setMapScope] = useState<MapScope>('day')
  const [selectedActivityKey, setSelectedActivityKey] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ key: string; sequence: number } | null>(null)
  const [previewPlace, setPreviewPlace] = useState<ResolvedPlace | null>(null)
  const addPlaceTriggerRef = useRef<HTMLButtonElement | null>(null)
  const selectedDayButtonRef = useRef<HTMLButtonElement | null>(null)
  const activityCardRefs = useRef(new Map<string, HTMLElement>())
  const dragSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const selectedDay = project.days.find((day) => day.id === selectedDayId) ?? project.days[0]
  const selectedDayIndex = Math.max(0, project.days.findIndex((day) => day.id === selectedDay?.id))
  const activeDayId = selectedDay?.id
  useEffect(() => {
    if (activeDayId) setSelectedDayId(activeDayId)
    selectedDayButtonRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeDayId])
  const selectDay = (dayId: string) => {
    if (isStopActionPending) return
    setSelectedDayId(dayId)
    setSelectedActivityKey(null)
    setShowAddPlace(false)
    setEditingActivity(undefined)
    setPreviewPlace(null)
  }
  const placeCount = useMemo(() => getProjectPlaceCount(project), [project])
  const status = getProjectStatus(project)
  const locationConfig = useMemo(
    () => providedLocationConfig === undefined ? getAmazonLocationConfig() : providedLocationConfig,
    [providedLocationConfig],
  )
  const placesGateway = useMemo(
    () => providedPlacesGateway === undefined
      ? (locationConfig ? createAmazonLocationPlacesGateway(locationConfig) : null)
      : providedPlacesGateway,
    [locationConfig, providedPlacesGateway],
  )
  const placeSearchBias = selectedDay?.activities.find((activity) => isValidCoordinates(activity.location))?.location
  const routesGateway = useMemo(() => {
    if (providedRoutesGateway !== undefined) return providedRoutesGateway ? cacheRoutesGateway(providedRoutesGateway) : null
    const config = getAmazonRoutesConfig()
    return config ? cacheRoutesGateway(createAmazonRoutesGateway(config)) : null
  }, [providedRoutesGateway])

  useEffect(() => {
    if (!focusRequest) {
      return
    }

    const card = activityCardRefs.current.get(focusRequest.key)
    if (!card) {
      return
    }

    card.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    card.focus()
  }, [focusRequest, selectedDayId])

  useEffect(() => {
    if (!selectedActivityKey) {
      return
    }

    const activityStillExists = project.days.some((day) =>
      day.activities.some((activity) => getActivityMapKey(day.id, activity.id) === selectedActivityKey),
    )

    if (!activityStillExists) {
      setSelectedActivityKey(null)
    }
  }, [project, selectedActivityKey])

  const saveTripDetails = async (updates: NewItineraryProject) => {
    setActionError(null)
    setIsSavingTrip(true)
    const succeeded = await onEdit(updates)
    setIsSavingTrip(false)

    if (succeeded) {
      setIsEditingTrip(false)
    } else {
      setActionError('Could not save the trip changes. Please try again.')
    }
  }

  const confirmDeleteTrip = async () => {
    setActionError(null)
    setIsDeletingTrip(true)
    const succeeded = await onDelete()

    if (!succeeded) {
      setIsDeletingTrip(false)
      setIsConfirmingDelete(false)
      setActionError('Could not delete the trip. Please try again.')
    }
  }

  if (!selectedDay) {
    return (
      <div className="min-h-dvh bg-[#f4f5f1] text-emerald-950">
        <PlannerHeader
          isBackDisabled={isStopActionPending || isSavingTrip}
          onBack={onBack}
          onDelete={() => setIsConfirmingDelete(true)}
          onEdit={() => { setShowAddPlace(false); setEditingActivity(undefined); setPreviewPlace(null); setIsEditingTrip(true) }}
          project={project}
        />
        {actionError && (
          <div className="border-b border-red-900/10 bg-red-50 px-4 py-3 text-sm text-red-900 sm:px-6" role="alert">
            {actionError}
          </div>
        )}
        {isConfirmingDelete && (
          <DeleteTripConfirm isDeleting={isDeletingTrip} onCancel={() => setIsConfirmingDelete(false)} onConfirm={confirmDeleteTrip} />
        )}
        {isEditingTrip && (
          <EditTripPanel isSaving={isSavingTrip} onCancel={() => setIsEditingTrip(false)} onSave={saveTripDetails} project={project} />
        )}
        <main className="mx-auto flex max-w-xl flex-col items-center px-5 py-24 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CalendarDays className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight">This trip has no days yet</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Return to the dashboard and create a trip with a valid date range.
          </p>
        </main>
      </div>
    )
  }

  const updateSelectedDay = (updateActivities: (activities: ItineraryActivity[]) => ItineraryActivity[]) => {
    onChange(project.id, (currentProject) => ({
      ...currentProject,
      days: currentProject.days.map((day) =>
        day.id === selectedDay.id ? withDayActivities(day, updateActivities(day.activities)) : day,
      ),
    }))
  }

  const updateTravel = (key: string, preference: TravelPreference) => {
    onChange(project.id, (currentProject) => ({
      ...currentProject,
      days: currentProject.days.map((day) => day.id === selectedDay.id
        ? { ...day, travel: { ...day.travel, [key]: preference } } : day),
    }))
  }

  // Appends/updates in place rather than sorting by time - order is driven
  // purely by position (see reorderActivity below), so time is display-only
  // metadata and never reshuffles the list on its own. Drag a place into a
  // different spot if needed.
  const saveActivity = (activity: ItineraryActivity) => {
    updateSelectedDay((activities) =>
      editingActivity ? activities.map((current) => current.id === activity.id ? activity : current) : [...activities, activity],
    )
    setShowAddPlace(false)
    setEditingActivity(undefined)
    setPreviewPlace(null)
    addPlaceTriggerRef.current?.focus()
  }

  const removePlace = async (activity: ItineraryActivity) => {
    if (isStopActionPending) {
      return
    }
    setActionError(null)
    setIsStopActionPending(true)

    try {
      if (project.backendTripId && activity.backendStopId) {
        try {
          await deleteBackendStop(project.backendTripId, activity.backendStopId, userId)
        } catch (error) {
          console.error('Could not delete the stop in the backend (is `npm run dev` running in backend/?):', error)
          setActionError('Could not delete this place. Please try again.')
          return
        }
      }

      if (selectedActivityKey === getActivityMapKey(selectedDay.id, activity.id)) {
        setSelectedActivityKey(null)
      }
      updateSelectedDay((activities) => activities.filter((current) => current.id !== activity.id))
    } finally {
      setIsStopActionPending(false)
    }
  }

  // Drag-and-drop reorders visually right away (dnd-kit already animates the
  // drop), rather than waiting on the backend first like the actions above -
  // waiting would show the list snapping back to its old order for a moment
  // after every drop. Rolled back on failure instead.
  const reorderActivity = async (activityId: number, targetIndex: number) => {
    if (isStopActionPending) {
      setActionError('Please wait for the current action to finish, then try again.')
      return
    }

    const previousActivities = selectedDay.activities
    // Snapshotted separately from previousActivities - withDayActivities only
    // ever drops travel entries that are no longer adjacent, it never restores
    // one, so undoing a drop caused by the optimistic move (e.g. "A:B" dropped
    // because moving C made it adjacent instead) needs this original snapshot
    // to merge back in on rollback, not just the reordered activities array.
    const previousTravel = selectedDay.travel
    const previousDayId = selectedDay.id
    const fromIndex = previousActivities.findIndex((current) => current.id === activityId)
    if (fromIndex === -1 || fromIndex === targetIndex) {
      return
    }

    setActionError(null)
    const reordered = arrayMove(previousActivities, fromIndex, targetIndex)
    updateSelectedDay(() => reordered)

    const movedActivity = previousActivities[fromIndex]
    if (!project.backendTripId || !movedActivity.backendStopId) {
      return
    }

    const newIndex = reordered.findIndex((current) => current.id === activityId)
    const previousStopId = reordered[newIndex - 1]?.backendStopId
    const nextStopId = reordered[newIndex + 1]?.backendStopId

    setIsStopActionPending(true)
    try {
      await updateBackendStop(project.backendTripId, movedActivity.backendStopId, userId, { previousStopId, nextStopId })
    } catch (error) {
      console.error('Could not save the new order in the backend (is `npm run dev` running in backend/?):', error)
      setActionError('Could not save the new order. Please try again.')
      // Merged, not overwritten wholesale - travel preferences aren't gated
      // behind isStopActionPending, so a user can legitimately change a
      // different leg's transport mode while this request is still in
      // flight. Blindly restoring the pre-drag `travel` object would discard
      // that edit too. Merging keeps it (current values win over the stale
      // snapshot for any key present in both), then withDayActivities prunes
      // the result back down to exactly the pairs valid for the restored
      // (pre-drag) order - including bringing back a preference the
      // optimistic move had dropped, like the comment above describes.
      onChange(project.id, (currentProject) => ({
        ...currentProject,
        days: currentProject.days.map((day) =>
          day.id === previousDayId
            ? withDayActivities({ ...day, travel: { ...previousTravel, ...day.travel } }, previousActivities)
            : day,
        ),
      }))
    } finally {
      setIsStopActionPending(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }
    const targetIndex = selectedDay.activities.findIndex((current) => current.id === over.id)
    if (targetIndex === -1) {
      return
    }
    reorderActivity(active.id as number, targetIndex)
  }

  const activateMarker = (marker: MapMarker) => {
    if (isStopActionPending) return
    setSelectedActivityKey(marker.key)
    setSelectedDayId(marker.dayId)
    setShowAddPlace(false)
    setEditingActivity(undefined)
    setPreviewPlace(null)
    setFocusRequest((current) => ({ key: marker.key, sequence: (current?.sequence ?? 0) + 1 }))
  }

  const closeAddPlace = () => {
    setShowAddPlace(false)
    setEditingActivity(undefined)
    setPreviewPlace(null)
    addPlaceTriggerRef.current?.focus()
  }

  return (
    <div className="min-h-dvh bg-[#f4f5f1] text-emerald-950 lg:h-dvh lg:overflow-hidden">
      <PlannerHeader
        isBackDisabled={isStopActionPending || isSavingTrip}
        onBack={onBack}
        onDelete={() => setIsConfirmingDelete(true)}
        onEdit={() => { setShowAddPlace(false); setEditingActivity(undefined); setPreviewPlace(null); setIsEditingTrip(true) }}
        project={project}
      />
      {actionError && (
        <div className="border-b border-red-900/10 bg-red-50 px-4 py-3 text-sm text-red-900 sm:px-6" role="alert">
          {actionError}
        </div>
      )}
      {isConfirmingDelete && (
        <DeleteTripConfirm isDeleting={isDeletingTrip} onCancel={() => setIsConfirmingDelete(false)} onConfirm={confirmDeleteTrip} />
      )}
      {isEditingTrip && (
        <EditTripPanel isSaving={isSavingTrip} onCancel={() => setIsEditingTrip(false)} onSave={saveTripDetails} project={project} />
      )}

      <main inert={isEditingTrip} className="grid lg:h-[calc(100dvh-4.5rem)] lg:grid-cols-[minmax(32rem,0.92fr)_minmax(30rem,1.08fr)]">
        <section className="scrollbar-hidden min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:overflow-y-auto lg:px-8">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Badge className="bg-amber-100 text-amber-900" variant="secondary">
                  {status}
                </Badge>
                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Build your itinerary</h2>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {formatDateRange(project.startDate, project.endDate)}
                  </span>
                  <span>{placeCount} {placeCount === 1 ? 'place' : 'places'}</span>
                </p>
              </div>
              <Button
                aria-controls="add-place-panel"
                aria-expanded={showAddPlace}
                className="h-10 rounded-xl px-4"
                disabled={isStopActionPending}
                onClick={() => { if (editingActivity) setPreviewPlace(null); setEditingActivity(undefined); setShowAddPlace(true) }}
                ref={addPlaceTriggerRef}
              >
                <Plus data-icon="inline-start" />
                Add a place
              </Button>
            </div>

            <div className="mt-5 flex justify-end gap-2" aria-label="Day navigation">
              <Button aria-label="Previous day" size="sm" variant="outline"
                disabled={isStopActionPending || selectedDayIndex === 0}
                onClick={() => selectDay(project.days[selectedDayIndex - 1].id)}>
                <ChevronLeft aria-hidden="true" />Previous
              </Button>
              <Button aria-label="Next day" size="sm" variant="outline"
                disabled={isStopActionPending || selectedDayIndex === project.days.length - 1}
                onClick={() => selectDay(project.days[selectedDayIndex + 1].id)}>
                Next<ChevronRight aria-hidden="true" />
              </Button>
            </div>
            <div className="scrollbar-hidden mt-3 overflow-x-auto pb-2" aria-label="Itinerary days">
              <div className="flex min-w-max gap-2">
                {project.days.map((day, index) => {
                  const label = getDayLabel(day.date, index)
                  const isSelected = day.id === selectedDay.id
                  return (
                    <button
                      ref={isSelected ? selectedDayButtonRef : undefined}
                      aria-pressed={isSelected}
                      className="min-w-28 rounded-xl border border-emerald-950/8 bg-white px-4 py-3 text-left shadow-sm transition hover:border-emerald-700/25 aria-pressed:border-emerald-800 aria-pressed:bg-emerald-800 aria-pressed:text-white disabled:opacity-50"
                      disabled={isStopActionPending}
                      key={day.id}
                      onClick={() => selectDay(day.id)}
                      type="button"
                    >
                      <span className="block text-xs font-semibold">{label.day}</span>
                      <span className={`mt-1 block text-xs ${isSelected ? 'text-emerald-100/75' : 'text-slate-500'}`}>
                        {label.date}
                      </span>
                      <span className={`mt-2 block text-[11px] ${isSelected ? 'text-emerald-100/60' : 'text-slate-400'}`}>
                        {day.activities.length} {day.activities.length === 1 ? 'place' : 'places'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-emerald-700 uppercase">Day {selectedDayIndex + 1}</p>
                <h3 className="mt-1 text-lg font-semibold">
                  {new Intl.DateTimeFormat('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' }).format(
                    new Date(`${selectedDay.date}T00:00:00`),
                  )}
                </h3>
              </div>
              <span className="text-xs text-slate-400">{selectedDay.activities.length} scheduled</span>
            </div>

            <div className="mt-4 space-y-3">
              <DndContext onDragEnd={handleDragEnd} sensors={dragSensors}>
                <SortableContext
                  items={selectedDay.activities.map((activity) => activity.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {selectedDay.activities.map((activity, index) => (
                    <Fragment key={`${project.id}:${selectedDay.id}:${activity.id}`}>
                      {index > 0 && <TravelLeg
                        key={getTravelLegKey(selectedDay.activities[index - 1].id, activity.id)}
                        from={selectedDay.activities[index - 1]}
                        to={activity}
                        preference={selectedDay.travel?.[getTravelLegKey(selectedDay.activities[index - 1].id, activity.id)]}
                        gateway={routesGateway}
                        onChange={(preference) => updateTravel(getTravelLegKey(selectedDay.activities[index - 1].id, activity.id), preference)}
                      />}
                      <ActivityCard
                        activity={activity}
                        isActionPending={isStopActionPending}
                        cardRef={(node) => {
                          const key = getActivityMapKey(selectedDay.id, activity.id)
                          if (node) {
                            activityCardRefs.current.set(key, node)
                          } else {
                            activityCardRefs.current.delete(key)
                          }
                        }}
                        index={index}
                        isOutOfTimeOrder={isOutOfTimeOrder(selectedDay.activities, index)}
                        isSelected={selectedActivityKey === getActivityMapKey(selectedDay.id, activity.id)}
                        onRemove={() => removePlace(activity)}
                        onEdit={() => { setEditingActivity(activity); setShowAddPlace(true); setPreviewPlace(null) }}
                      />
                    </Fragment>
                  ))}
                </SortableContext>
              </DndContext>

              {selectedDay.activities.length === 0 && !showAddPlace && (
                <div className="rounded-2xl border border-dashed border-emerald-900/20 bg-white/45 px-6 py-10 text-center">
                  <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                    <MapPin className="size-5" aria-hidden="true" />
                  </span>
                  <p className="mt-4 font-semibold">Nothing planned for this day yet</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    Add a landmark, meal, hotel, or anything else you want to remember.
                  </p>
                  <Button
                    aria-controls="add-place-panel"
                    aria-expanded={showAddPlace}
                    className="mt-5 rounded-xl"
                    onClick={() => { setEditingActivity(undefined); setPreviewPlace(null); setShowAddPlace(true) }}
                    variant="outline"
                  >
                    <Plus data-icon="inline-start" />
                    Add the first place
                  </Button>
                </div>
              )}

              {showAddPlace && (
                <ActivityForm
                  key={editingActivity?.id ?? 'new'}
                  activity={editingActivity}
                  days={project.days}
                  isActionPending={isStopActionPending}
                  backendTripId={project.backendTripId}
                  userId={userId}
                  biasPosition={placeSearchBias}
                  date={selectedDay.date}
                  destination={project.destination}
                  gateway={placesGateway}
                  previousActivity={editingActivity ? undefined : selectedDay.activities.at(-1)}
                  onSave={saveActivity}
                  onCancel={closeAddPlace}
                  onPreviewChange={setPreviewPlace}
                  onSubmittingChange={setIsStopActionPending}
                />
              )}

              {selectedDay.activities.length > 0 && !showAddPlace && (
                <button
                  aria-controls="add-place-panel"
                  aria-expanded={showAddPlace}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-900/20 bg-white/35 px-4 py-4 text-sm font-medium text-emerald-700 transition hover:border-emerald-700/35 hover:bg-white"
                  onClick={() => { setEditingActivity(undefined); setPreviewPlace(null); setShowAddPlace(true) }}
                  type="button"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add another place
                </button>
              )}
            </div>

            <footer className="mt-6 space-y-2 text-xs leading-5 text-slate-500">
              <p>Travel estimates use current routing conditions and do not automatically change scheduled activity times.</p>
              <a className="text-emerald-700 underline underline-offset-2" href="https://docs.aws.amazon.com/location/latest/developerguide/data-attribution.html" target="_blank" rel="noopener noreferrer">AWS data attribution</a>
            </footer>

            <div className="mt-6 flex gap-3 rounded-2xl bg-amber-50 p-4 text-xs leading-5 text-amber-950 ring-1 ring-amber-900/10">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {project.backendTripId
                  ? 'Trip changes are saved to your account. Route optimisation will connect to a future API.'
                  : 'This trip could not be saved to your account (the backend may be unreachable), so changes are only stored for this session.'}
              </p>
            </div>
          </div>
        </section>

        <ItineraryMap
          locationConfig={locationConfig}
          onMarkerActivate={activateMarker}
          onScopeChange={setMapScope}
          previewPlace={previewPlace}
          project={project}
          scope={mapScope}
          selectedDayId={selectedDay.id}
          selectedMarkerKey={selectedActivityKey}
        />
      </main>
    </div>
  )
}
