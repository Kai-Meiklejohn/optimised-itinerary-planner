import { expect, it, vi } from 'vitest'
import { withBackendPlaceDetails } from './backend-places'
import type { PlacesGateway } from './amazon-location'

it('uses backend English details and its suggested category instead of the legacy result', async () => {
  const legacy: PlacesGateway = { suggest: vi.fn(), resolve: vi.fn().mockResolvedValue({ name: 'Tokyo Sky Tree', address: 'Sumida, Japan', category: 'Other', location: { lat: 35, lng: 139 }, placeId: 'legacy-id' }) }
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'Tokyo Skytree', placeId: 'v2-id', category: 'Food', address: 'Tokyo', location: { lat: 35.7, lng: 139.8 } }) })
  vi.stubGlobal('fetch', fetcher)
  const gateway = withBackendPlaceDetails(legacy, 'trip-1', 'Tokyo')
  const place = await gateway.resolve({ id: '1', text: 'Tokyo Sky Tree', categories: [] })
  expect(place).toMatchObject({ name: 'Tokyo Skytree', backendPlaceId: 'v2-id', category: 'Food', location: { lat: 35.7, lng: 139.8 } })
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ query: 'Tokyo Sky Tree', destination: 'Tokyo', address: 'Sumida, Japan' })
})

it('surfaces a failed backend lookup instead of accepting mismatched legacy details', async () => {
  const legacy: PlacesGateway = { suggest: vi.fn(), resolve: vi.fn().mockResolvedValue({ name: 'Louvre', address: 'Paris' }) }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
  await expect(withBackendPlaceDetails(legacy, 'trip-1', 'Paris').resolve({ id: '1', text: 'Louvre', categories: [] })).rejects.toThrow()
})

it('discards a result after cancellation even if the legacy provider ignores the signal', async () => {
  let finish!: (value: Awaited<ReturnType<PlacesGateway['resolve']>>) => void
  const controller = new AbortController()
  const legacy: PlacesGateway = { suggest: vi.fn(), resolve: vi.fn(() => new Promise<Awaited<ReturnType<PlacesGateway['resolve']>>>((resolve) => { finish = resolve })) }
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = withBackendPlaceDetails(legacy, 'trip-1', 'Seoul').resolve({ id: '1', text: 'Seoul Station', categories: [] }, { signal: controller.signal })
  controller.abort()
  finish({ name: 'Seoul Station', category: 'Transport', address: 'Seoul', provider: 'amazon-location', region: 'us-east-1' })
  await expect(result).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('bounds resolution with a 15-second abort signal', async () => {
  const deadline = new AbortController()
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const legacy: PlacesGateway = { suggest: vi.fn(), resolve: vi.fn().mockResolvedValue({ name: 'Louvre', address: 'Paris' }) }
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason))
  })))
  const result = withBackendPlaceDetails(legacy, 'trip-1', 'Paris').resolve({ id: '1', text: 'Louvre', categories: [] })
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  deadline.abort(new DOMException('Timed out', 'TimeoutError'))
  await expect(result).rejects.toThrow('Timed out')
  expect(timeout).toHaveBeenCalledWith(15_000)
  timeout.mockRestore()
})
