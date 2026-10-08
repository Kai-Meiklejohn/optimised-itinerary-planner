export type ActivityCategory = 'Attraction' | 'Food' | 'Stay' | 'Transport' | 'Other'

export type Coordinates = {
  lat: number
  lng: number
}

export type VenueHours = {
  displayLines: string[]
  source: 'amazon-location'
}

export type PlaceReference = {
  provider: 'amazon-location'
  placeId: string
  region: string
}

export type ItineraryActivity = {
  id: number
  name: string
  category: ActivityCategory
  time: string
  duration: string
  address: string
  notes?: string
  location?: Coordinates
  place?: PlaceReference
  venueHours?: VenueHours
  backendStopId?: string
}

export type ItineraryDay = {
  id: string
  date: string
  activities: ItineraryActivity[]
  travel?: Record<string, TravelPreference>
}

export type TravelMode = 'driving' | 'walking' | 'transit' | 'flying' | 'other'
export type TravelPreference = { mode: TravelMode; minutes?: number }

export function getTravelLegKey(fromId: number, toId: number) {
  return `${fromId}:${toId}`
}

export function withDayActivities(day: ItineraryDay, activities: ItineraryActivity[]): ItineraryDay {
  const pairs = new Set(activities.slice(1).map((activity, index) => getTravelLegKey(activities[index].id, activity.id)))
  return {
    ...day,
    activities,
    ...(day.travel ? { travel: Object.fromEntries(Object.entries(day.travel).filter(([key]) => pairs.has(key))) } : {}),
  }
}

// Order is set purely by position (manual drag or append) and never derived
// from time, so a stop can legitimately sit earlier in the list than its own
// start time would suggest - e.g. after being dragged there on purpose. This
// flags that mismatch for display rather than ever silently reordering or
// rewriting anyone's times to "fix" it.
export function isOutOfTimeOrder(activities: readonly Pick<ItineraryActivity, 'time' | 'duration'>[], index: number): boolean {
  const current = activities[index]
  const previous = activities[index - 1]
  if (!current?.time || !previous?.time) return false

  const previousEnd = getActivityEndTime(previous)
  // Once the previous stop's own end time has already rolled past midnight
  // (visible to the user as its "(next day)" end time), comparing `current`
  // against `previous`'s raw start time no longer makes sense - a stop
  // starting right after midnight is a legitimate continuation, not "out of
  // order", even though its HH:MM reads earlier than `previous`'s start. The
  // question that actually matters is whether `current` starts before
  // `previous` has finished, so compare against the rolled-over end time
  // instead of bailing out of the check altogether.
  if (previousEnd && previousEnd.dayOffset > 0) return current.time < previousEnd.time

  return current.time < previous.time
}

export type ItineraryProject = {
  id: number
  name: string
  destination: string
  startDate: string
  endDate: string
  collaborators: number
  accent: string
  days: ItineraryDay[]
  backendTripId?: string
}

export type NewItineraryProject = Pick<ItineraryProject, 'name' | 'destination' | 'startDate' | 'endDate'>

export const MAX_ITINERARY_DAYS = 60

// Keep the existing display-string model; accept explicit hours/minutes up to one day.
export function parseActivityDuration(duration: string): number | null {
  const match = /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/i.exec(duration.trim())
  if (!match) return null

  const minutes = Math.round(Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0)
  return minutes >= 1 && minutes <= 1440 ? minutes : null
}

export function getActivityEndTime(activity: Pick<ItineraryActivity, 'time' | 'duration'>) {
  const durationMinutes = parseActivityDuration(activity.duration)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(activity.time) || durationMinutes === null) return null

  const [hours, minutes] = activity.time.split(':').map(Number)
  const endMinutes = hours * 60 + minutes + durationMinutes
  const endHours = Math.floor(endMinutes / 60) % 24
  return {
    time: `${String(endHours).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`,
    dayOffset: Math.floor(endMinutes / 1440),
  }
}

// Compare calendar dates as UTC offsets so browser time zones and DST do not
// change the user's wall-clock schedule. Endpoints may touch without overlapping.
export function findActivityOverlap(days: ItineraryDay[], date: string,
  candidate: Pick<ItineraryActivity, 'time' | 'duration'>, excludedId?: number) {
  const interval = (day: string, activity: Pick<ItineraryActivity, 'time' | 'duration'>) => {
    const duration = parseActivityDuration(activity.duration)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(activity.time) || duration === null) return null
    const [hours, minutes] = activity.time.split(':').map(Number)
    const start = Date.parse(`${day}T00:00:00Z`) / 60_000 + hours * 60 + minutes
    return { start, end: start + duration }
  }
  const proposed = interval(date, candidate)
  if (!proposed) return undefined
  for (const day of days) {
    for (const activity of day.activities) {
      if (activity.id === excludedId) continue
      const existing = interval(day.date, activity)
      if (existing && proposed.start < existing.end && existing.start < proposed.end) return activity
    }
  }
}

const millisecondsPerDay = 24 * 60 * 60 * 1000
let lastClientId = 0

function parseIsoDateAsUtc(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)

  if (!match) {
    return null
  }

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)

  if (year < 1) {
    return null
  }

  const parsedDate = new Date(0)
  parsedDate.setUTCFullYear(year, month - 1, day)
  parsedDate.setUTCHours(0, 0, 0, 0)

  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    return null
  }

  return parsedDate
}

export function getItineraryDayCount(startDate: string, endDate: string) {
  const start = parseIsoDateAsUtc(startDate)
  const end = parseIsoDateAsUtc(endDate)

  if (!start || !end) {
    return 0
  }

  const dayCount = Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay) + 1

  return Number.isFinite(dayCount) ? dayCount : 0
}

export function createItineraryDays(startDate: string, endDate: string): ItineraryDay[] {
  const days: ItineraryDay[] = []
  const current = parseIsoDateAsUtc(startDate)
  const dayCount = getItineraryDayCount(startDate, endDate)

  if (!current || !Number.isFinite(dayCount) || dayCount < 1 || dayCount > MAX_ITINERARY_DAYS) {
    return days
  }

  for (let index = 0; index < dayCount; index += 1) {
    const date = current.toISOString().slice(0, 10)
    days.push({ id: date, date, activities: [] })
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return days
}

export function updateItineraryDates(project: ItineraryProject, startDate: string, endDate: string): ItineraryProject {
  const days = createItineraryDays(startDate, endDate)
  if (!days.length) throw new Error(`Choose a valid trip range of 1 to ${MAX_ITINERARY_DAYS} days.`)
  if (project.days.some((day) => (day.date < startDate || day.date > endDate) && day.activities.length)) {
    throw new Error('Remove the places on excluded days before changing the trip dates.')
  }
  const existing = new Map(project.days.map((day) => [day.date, day]))
  return { ...project, startDate, endDate, days: days.map((day) => existing.get(day.date) ?? day) }
}

export function formatDateRange(startDate: string, endDate: string) {
  const formatter = new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return `${formatter.format(new Date(`${startDate}T00:00:00`))} - ${formatter.format(
    new Date(`${endDate}T00:00:00`),
  )}`
}

export function getProjectPlaceCount(project: ItineraryProject) {
  return project.days.reduce((total, day) => total + day.activities.length, 0)
}

export function getProjectStatus(project: ItineraryProject): 'Planning' | 'Ready to plan' {
  return getProjectPlaceCount(project) > 0 ? 'Planning' : 'Ready to plan'
}

export function createClientId() {
  lastClientId = Math.max(lastClientId + 1, Date.now())
  return lastClientId
}

export const initialProjects: ItineraryProject[] = [
  {
    id: 1,
    name: 'Kyoto in spring',
    destination: 'Kyoto, Japan',
    startDate: '2027-04-21',
    endDate: '2027-04-24',
    collaborators: 2,
    accent: 'from-[#276b54] to-[#84a98c]',
    days: [
      {
        id: '2027-04-21',
        date: '2027-04-21',
        activities: [
          {
            id: 101,
            name: 'Fushimi Inari Taisha',
            category: 'Attraction',
            time: '09:00',
            duration: '2 hr',
            address: '68 Fukakusa Yabunouchicho, Fushimi Ward',
            location: { lat: 34.9671, lng: 135.7727 },
          },
          {
            id: 102,
            name: 'Nishiki Market',
            category: 'Food',
            time: '12:30',
            duration: '1.5 hr',
            address: 'Nakagyo Ward, Kyoto',
            location: { lat: 35.005, lng: 135.7649 },
          },
          {
            id: 103,
            name: 'Kiyomizu-dera',
            category: 'Attraction',
            time: '15:00',
            duration: '2 hr',
            address: '1 Chome-294 Kiyomizu, Higashiyama Ward',
            location: { lat: 34.9949, lng: 135.785 },
          },
        ],
      },
      {
        id: '2027-04-22',
        date: '2027-04-22',
        activities: [
          {
            id: 104,
            name: 'Arashiyama Bamboo Forest',
            category: 'Attraction',
            time: '08:30',
            duration: '2 hr',
            address: 'Sagaogurayama Tabuchiyamacho, Ukyo Ward',
            location: { lat: 35.017, lng: 135.6713 },
          },
          {
            id: 105,
            name: 'Tenryu-ji',
            category: 'Attraction',
            time: '11:00',
            duration: '1.5 hr',
            address: '68 Sagatenryuji Susukinobabacho, Ukyo Ward',
            location: { lat: 35.0158, lng: 135.6738 },
          },
        ],
      },
      {
        id: '2027-04-23',
        date: '2027-04-23',
        activities: [
          {
            id: 106,
            name: 'Kinkaku-ji',
            category: 'Attraction',
            time: '10:00',
            duration: '1.5 hr',
            address: '1 Kinkakujicho, Kita Ward',
            location: { lat: 35.0394, lng: 135.7292 },
          },
          {
            id: 107,
            name: 'Gion district walk',
            category: 'Other',
            time: '17:30',
            duration: '2 hr',
            address: 'Gionmachi, Higashiyama Ward',
            location: { lat: 35.0037, lng: 135.7788 },
          },
        ],
      },
      { id: '2027-04-24', date: '2027-04-24', activities: [] },
    ],
  },
  {
    id: 2,
    name: 'South Island road trip',
    destination: 'Queenstown, New Zealand',
    startDate: '2027-07-06',
    endDate: '2027-07-14',
    collaborators: 1,
    accent: 'from-[#315979] to-[#91b7c7]',
    days: [
      {
        id: '2027-07-06',
        date: '2027-07-06',
        activities: [
          {
            id: 201,
            name: 'Queenstown Gardens',
            category: 'Attraction',
            time: '10:00',
            duration: '1.5 hr',
            address: 'Queenstown 9300',
            location: { lat: -45.0356, lng: 168.6618 },
          },
        ],
      },
      { id: '2027-07-07', date: '2027-07-07', activities: [] },
      {
        id: '2027-07-08',
        date: '2027-07-08',
        activities: [
          {
            id: 202,
            name: 'Milford Sound day trip',
            category: 'Transport',
            time: '07:00',
            duration: '12 hr',
            address: 'Milford Sound, Southland',
            location: { lat: -44.6719, lng: 167.9256 },
          },
        ],
      },
      { id: '2027-07-09', date: '2027-07-09', activities: [] },
      { id: '2027-07-10', date: '2027-07-10', activities: [] },
      { id: '2027-07-11', date: '2027-07-11', activities: [] },
      {
        id: '2027-07-12',
        date: '2027-07-12',
        activities: [
          {
            id: 203,
            name: 'Lake Tekapo lookout',
            category: 'Attraction',
            time: '14:00',
            duration: '1 hr',
            address: 'Lake Tekapo 7999',
            location: { lat: -44.0047, lng: 170.4771 },
          },
          {
            id: 204,
            name: 'Dark Sky stargazing',
            category: 'Attraction',
            time: '21:00',
            duration: '2 hr',
            address: '1 Motuariki Lane, Lake Tekapo',
            location: { lat: -43.9856, lng: 170.465 },
          },
        ],
      },
      { id: '2027-07-13', date: '2027-07-13', activities: [] },
      { id: '2027-07-14', date: '2027-07-14', activities: [] },
    ],
  },
]
