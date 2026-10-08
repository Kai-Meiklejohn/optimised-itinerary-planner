import type { ActivityCategory, Coordinates } from '@/itinerary'
import { getSessionVersion, refreshSession, SessionChangedError } from '@/services/authService'

function getApiBaseUrl() {
  const configured = (import.meta.env.VITE_BACKEND_API_URL as string | undefined)?.trim()
  if (configured) {
    return configured
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:3001'
  }
  throw new Error(
    'Missing VITE_BACKEND_API_URL. Set it in the production build environment before deploying trip/stop backend calls.',
  )
}

export class BackendRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'BackendRequestError'
    this.status = status
  }
}

function getAuthHeaders(): Record<string, string> {
  const idToken = localStorage.getItem('idToken')
  return idToken ? { Authorization: `Bearer ${idToken}` } : {}
}

async function requestJson<T>(path: string, init?: RequestInit, isRetryAfterRefresh = false): Promise<T> {
  const version = getSessionVersion()
  const checkSession = () => {
    if (getSessionVersion() !== version) throw new BackendRequestError(401, 'Session changed. Please sign in again.')
  }
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  })

  checkSession()

  // A 401 here means the ID token itself was rejected (expired/invalid), not that the
  // caller lacks permission for this resource - silently refresh once and retry before
  // giving up, so a request doesn't fail just because the token happened to expire.
  if (response.status === 401 && !isRetryAfterRefresh && localStorage.getItem('refreshToken')) {
    try {
      await refreshSession()
      checkSession()
      return await requestJson<T>(path, init, true)
    } catch (refreshError) {
      // A session change is an actionable, specific signal the caller should
      // see - swallowing it here would surface a generic status-based error
      // instead, hiding why the request actually failed.
      if (refreshError instanceof SessionChangedError
        || (refreshError instanceof BackendRequestError && refreshError.status === 401)) {
        throw refreshError
      }
      console.error('Could not refresh the session:', refreshError)
    }
  }

  if (!response.ok) {
    throw new BackendRequestError(response.status, `Backend request to ${path} failed with status ${response.status}`)
  }

  const result = await response.json() as T
  checkSession()
  return result
}

export type BackendTrip = {
  tripId: string
  userId: string
  name: string
  destination: string
  startDate: string
  endDate: string
}

export type BackendStop = {
  tripId: string
  stopId: string
  placeName: string
  category: ActivityCategory
  location?: Coordinates
  placeId: string
  visitDurationMinutes: number
  priority: number
  date?: string
  time?: string
  notes?: string
  address?: string
}

export function createBackendTrip(input: {
  userId: string
  name: string
  destination: string
  startDate: string
  endDate: string
}) {
  return requestJson<BackendTrip>('/trips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function listBackendTrips(userId: string) {
  return requestJson<BackendTrip[]>(`/trips?userId=${encodeURIComponent(userId)}`)
}

export function updateBackendTrip(tripId: string, userId: string, updates: { name: string; destination: string; startDate?: string; endDate?: string }) {
  return requestJson<BackendTrip>(`/trips/${tripId}?userId=${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export function deleteBackendTrip(tripId: string, userId: string) {
  return requestJson<{ message: string }>(`/trips/${tripId}?userId=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export function createBackendStop(tripId: string, userId: string, input: {
  placeId?: string
  query: string
  destination: string
  address?: string
  notes?: string
  placeSelected?: boolean
  visitDurationMinutes: number
  priority: number
  date: string
  time?: string
  category?: ActivityCategory
}) {
  return requestJson<BackendStop>(`/trips/${tripId}/stops?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateBackendStop(tripId: string, stopId: string, userId: string, updates: { time?: string; notes?: string; category?: ActivityCategory; visitDurationMinutes?: number; address?: string; placeId?: string; previousStopId?: string; nextStopId?: string }) {
  return requestJson<BackendStop>(`/trips/${tripId}/stops/${stopId}?userId=${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export function deleteBackendStop(tripId: string, stopId: string, userId: string) {
  return requestJson<{ message: string }>(`/trips/${tripId}/stops/${stopId}?userId=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export function listBackendStops(tripId: string, userId: string) {
  return requestJson<BackendStop[]>(`/trips/${tripId}/stops?userId=${encodeURIComponent(userId)}`)
}

export type BackendUser = {
  userId: string
  email: string
  displayName?: string
  createdAt: string
}

export function createBackendUser(input: { userId: string; email: string; displayName?: string }) {
  return requestJson<BackendUser>('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export type BackendPlace = {
  placeId: string
  name: string
  address?: string
  category: ActivityCategory
  location?: Coordinates
}

export function resolveBackendPlace(tripId: string, input: { query: string; destination: string; address?: string }, signal?: AbortSignal) {
  return requestJson<BackendPlace>(`/trips/${tripId}/stops/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  })
}
