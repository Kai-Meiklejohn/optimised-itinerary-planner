import { describe, expect, it, vi } from 'vitest'
import { cacheRoutesGateway } from './cached-routes'

const a = { lat: 35, lng: 135 }
const b = { lat: 36, lng: 136 }
const c = { lat: 37, lng: 137 }

describe('route estimate cache', () => {
  it('reuses successful coordinates and mode, with directional and mode-specific keys', async () => {
    const estimate = vi.fn().mockResolvedValue({ durationSeconds: 60 })
    const gateway = cacheRoutesGateway({ estimate })
    await gateway.estimate(a, b, 'driving')
    await gateway.estimate({ ...a }, { ...b }, 'driving')
    expect(estimate).toHaveBeenCalledTimes(1)
    await gateway.estimate(b, a, 'driving')
    await gateway.estimate(a, b, 'walking')
    await gateway.estimate(a, c, 'driving')
    expect(estimate).toHaveBeenCalledTimes(4)
  })

  it('does not cache failures or late aborted results', async () => {
    const estimate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ durationSeconds: 60 })
    const gateway = cacheRoutesGateway({ estimate })
    await expect(gateway.estimate(a, b, 'walking')).rejects.toThrow('offline')
    const controller = new AbortController()
    const pending = gateway.estimate(a, b, 'walking', controller.signal)
    controller.abort()
    await pending
    await gateway.estimate(a, b, 'walking')
    expect(estimate).toHaveBeenCalledTimes(3)
  })
})
