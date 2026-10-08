import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/authService')>()
  return {
    ...actual,
    refreshSession: vi.fn(),
    getSessionVersion: vi.fn(() => 0),
  }
})

import { getSessionVersion, refreshSession } from '@/services/authService'
import {
  BackendRequestError,
  createBackendStop,
  createBackendTrip,
  createBackendUser,
  deleteBackendStop,
  deleteBackendTrip,
  listBackendStops,
  listBackendTrips,
  updateBackendStop,
  updateBackendTrip,
} from './backendApi'

describe('backendApi', () => {
  it('fails closed instead of silently targeting localhost when built for production with no backend URL configured', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_BACKEND_API_URL', '')

    await expect(
      createBackendTrip({
        userId: 'user-1',
        name: 'Kyoto in spring',
        destination: 'Kyoto, Japan',
        startDate: '2027-04-21',
        endDate: '2027-04-24',
      }),
    ).rejects.toThrow('Missing VITE_BACKEND_API_URL')

    vi.unstubAllEnvs()
  })

  it('resolves with the parsed body when the backend responds ok', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tripId: 'trip-1' }),
    } as Response)

    const trip = await createBackendTrip({
      userId: 'user-1',
      name: 'Kyoto in spring',
      destination: 'Kyoto, Japan',
      startDate: '2027-04-21',
      endDate: '2027-04-24',
    })

    expect(trip).toEqual({ tripId: 'trip-1' })
  })

  it('throws a BackendRequestError instead of returning as if the write succeeded when the response is not ok', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'Invalid trip input' }),
    } as Response)

    await expect(
      createBackendTrip({
        userId: 'user-1',
        name: '',
        destination: 'Kyoto, Japan',
        startDate: '2027-04-21',
        endDate: '2027-04-24',
      }),
    ).rejects.toBeInstanceOf(BackendRequestError)
  })

  it('never includes a placeId in the stop-creation body, since legacy search IDs are not compatible with the backend\'s place resolution', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1' }),
    } as Response)

    await createBackendStop('trip-1', 'user-1', {
      query: 'Fushimi Inari Taisha',
      destination: 'Kyoto, Japan',
      visitDurationMinutes: 60,
      priority: 3,
      date: '2027-04-21',
    })

    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(requestInit?.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('placeId')
    expect(body.query).toBe('Fushimi Inari Taisha')
  })

  it('updates a trip against the userId-scoped PATCH route', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tripId: 'trip-1', name: 'New name' }),
    } as Response)

    await updateBackendTrip('trip-1', 'user-1', { name: 'New name', destination: 'Tokyo, Japan' })

    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1?userId=user-1')
    expect(requestInit?.method).toBe('PATCH')
  })

  it('deletes a trip against the userId-scoped DELETE route', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'Deleted' }),
    } as Response)

    await deleteBackendTrip('trip-1', 'user-1')

    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1?userId=user-1')
    expect(requestInit?.method).toBe('DELETE')
  })

  it('deletes a stop by tripId and stopId', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'Deleted' }),
    } as Response)

    await deleteBackendStop('trip-1', 'stop-1', 'user-1')

    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1/stops/stop-1?userId=user-1')
    expect(requestInit?.method).toBe('DELETE')
  })

  it('lists a user\'s trips against the userId-scoped GET route', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ tripId: 'trip-1' }]),
    } as Response)

    const trips = await listBackendTrips('user-1')

    expect(trips).toEqual([{ tripId: 'trip-1' }])
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips?userId=user-1')
  })

  it('updates a stop\'s time against the PATCH route', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', time: '09:30' }),
    } as Response)

    await updateBackendStop('trip-1', 'stop-1', 'user-1', { time: '09:30' })

    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1/stops/stop-1?userId=user-1')
    expect(requestInit?.method).toBe('PATCH')
    expect(JSON.parse(requestInit?.body as string)).toEqual({ time: '09:30' })
  })

  it('lists a trip\'s stops', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ stopId: 'stop-1' }]),
    } as Response)

    const stops = await listBackendStops('trip-1', 'user-1')

    expect(stops).toEqual([{ stopId: 'stop-1' }])
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1/stops?userId=user-1')
  })

  it('creates a user profile against the /users route', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ userId: 'user-1', email: 'kai@example.com', createdAt: 'x' }),
    } as Response)

    const user = await createBackendUser({ userId: 'user-1', email: 'kai@example.com', displayName: 'Kai' })

    expect(user.userId).toBe('user-1')
    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/users')
    expect(requestInit?.method).toBe('POST')
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      userId: 'user-1',
      email: 'kai@example.com',
      displayName: 'Kai',
    })
  })

  describe('expired ID token retry', () => {
    afterEach(() => {
      localStorage.clear()
      vi.mocked(refreshSession).mockReset()
    })

    it('silently refreshes and retries once when the backend rejects an expired ID token', async () => {
      localStorage.setItem('idToken', 'expired-id-token')
      localStorage.setItem('refreshToken', 'refresh-token')
      vi.mocked(refreshSession).mockImplementationOnce(async () => {
        localStorage.setItem('idToken', 'fresh-id-token')
        return { accessToken: 'fresh-access-token', idToken: 'fresh-id-token', refreshToken: 'refresh-token' }
      })
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Unauthorized' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ tripId: 'trip-1' }]) } as Response)

      const trips = await listBackendTrips('user-1')

      expect(trips).toEqual([{ tripId: 'trip-1' }])
      expect(refreshSession).toHaveBeenCalledTimes(1)
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2)
      const [, secondRequestInit] = vi.mocked(globalThis.fetch).mock.calls[1]
      const secondHeaders = secondRequestInit!.headers as Record<string, string>
      expect(secondHeaders.Authorization).toBe('Bearer fresh-id-token')
    })

    it('surfaces the original 401 as a BackendRequestError when the refresh itself fails', async () => {
      localStorage.setItem('idToken', 'expired-id-token')
      localStorage.setItem('refreshToken', 'stale-refresh-token')
      vi.mocked(refreshSession).mockRejectedValueOnce(new Error('Refresh token is expired'))
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized' }),
      } as Response)

      await expect(listBackendTrips('user-1')).rejects.toBeInstanceOf(BackendRequestError)
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
    })

    it('does not attempt a refresh when there is no refresh token to use', async () => {
      localStorage.setItem('idToken', 'expired-id-token')
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Unauthorized' }),
      } as Response)

      await expect(listBackendTrips('user-1')).rejects.toBeInstanceOf(BackendRequestError)
      expect(refreshSession).not.toHaveBeenCalled()
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
    })
  })
})

it('discards a response from a session that signed out while the request was pending', async () => {
  vi.mocked(getSessionVersion).mockReturnValueOnce(1).mockReturnValue(2)
  vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => [{ tripId: 'private' }] } as Response)
  await expect(listBackendTrips('old-user')).rejects.toThrow('Session changed')
  vi.mocked(getSessionVersion).mockReturnValue(0)
})

it('never retries an old request using a newer account after a delayed 401', async () => {
  localStorage.setItem('refreshToken', 'new-account')
  vi.mocked(getSessionVersion).mockReturnValueOnce(1).mockReturnValue(2)
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response)
  vi.mocked(refreshSession).mockClear()
  await expect(listBackendTrips('old-user')).rejects.toThrow('Session changed')
  expect(refreshSession).not.toHaveBeenCalled()
  vi.mocked(getSessionVersion).mockReturnValue(0)
  localStorage.clear()
})
