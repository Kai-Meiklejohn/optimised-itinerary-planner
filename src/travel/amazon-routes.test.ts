import { describe, expect, it, vi } from 'vitest'
import { createAmazonRoutesGateway, getAmazonRoutesConfig } from './amazon-routes'

const config = { apiKey: 'test-routes-key', region: 'us-east-1' }
const from = { lat: 35.01, lng: 135.76 }
const to = { lat: 35.02, lng: 135.78 }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('Amazon Routes gateway', () => {
  it('requires separate optional routing configuration', () => {
    expect(getAmazonRoutesConfig({ VITE_AWS_LOCATION_API_KEY: 'map-key', VITE_AWS_REGION: 'us-east-1' })).toBeNull()
    expect(getAmazonRoutesConfig({ VITE_AWS_ROUTES_API_KEY: 'test', VITE_AWS_REGION: 'invalid.region' })).toBeNull()
    expect(getAmazonRoutesConfig({ VITE_AWS_ROUTES_API_KEY: ' test-routes-key ', VITE_AWS_REGION: ' us-east-1 ' })).toEqual(config)
  })

  it('uses supported modes, longitude-first coordinates, current departure and the caller abort signal', async () => {
    const fetcher = vi.fn(async () => json({ Routes: [{ Summary: { Duration: 601 } }] }))
    const gateway = createAmazonRoutesGateway(config, fetcher)
    const controller = new AbortController()
    for (const [mode, providerMode] of [['driving', 'Car'], ['walking', 'Pedestrian'], ['transit', 'Transit']] as const) {
      await expect(gateway.estimate(from, to, mode, controller.signal)).resolves.toEqual({ durationSeconds: 601 })
      expect(fetcher).toHaveBeenLastCalledWith('https://routes.geo.us-east-1.amazonaws.com/v2/routes?key=test-routes-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ Origin: [135.76, 35.01], Destination: [135.78, 35.02], TravelMode: providerMode, DepartNow: true, MaxAlternatives: 0 }),
      })
    }
  })

  it('accepts zero duration but rejects missing or malformed estimates and invalid coordinates', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ Routes: [{ Summary: { Duration: 0 } }] }))
    const gateway = createAmazonRoutesGateway(config, fetcher)
    await expect(gateway.estimate(from, to, 'walking')).resolves.toEqual({ durationSeconds: 0 })
    for (const body of [{ Routes: [] }, null, { Routes: {} }, { Routes: [{ Summary: { Duration: -1 } }] }, { Routes: [{ Summary: { Duration: '12' } }] }]) {
      fetcher.mockResolvedValueOnce(json(body))
      await expect(gateway.estimate(from, to, 'walking')).rejects.toThrow(/No usable route/)
    }
    fetcher.mockClear()
    await expect(gateway.estimate({ lat: NaN, lng: 0 }, to, 'driving')).rejects.toThrow(/coordinates/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('maps errors safely without exposing response bodies, URLs or keys', async () => {
    const fetcher = vi.fn()
    const gateway = createAmazonRoutesGateway(config, fetcher)
    for (const [status, message] of [[403, /not authorised/], [429, /busy/], [400, /No usable route/], [500, /unavailable/]] as const) {
      fetcher.mockResolvedValueOnce(json({ message: 'private-provider-details' }, status))
      await expect(gateway.estimate(from, to, 'driving')).rejects.toThrow(message)
    }
    fetcher.mockRejectedValueOnce(new Error('https://example.com/?key=test-routes-key'))
    await expect(gateway.estimate(from, to, 'driving')).rejects.toThrow('Travel estimates are temporarily unavailable.')
    fetcher.mockResolvedValueOnce(new Response('not-json'))
    await expect(gateway.estimate(from, to, 'driving')).rejects.toThrow(/No usable route/)
  })
})
