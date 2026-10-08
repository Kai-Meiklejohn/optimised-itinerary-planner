import type { RoutesGateway, TravelEstimate } from './amazon-routes'

/** Successful estimates live only for this planner session, never in trip storage. */
export function cacheRoutesGateway(gateway: RoutesGateway): RoutesGateway {
  const results = new Map<string, TravelEstimate>()
  return {
    async estimate(from, to, mode, signal) {
      const key = JSON.stringify([from.lat, from.lng, to.lat, to.lng, mode])
      const cached = results.get(key)
      if (cached) return cached
      const result = await gateway.estimate(from, to, mode, signal)
      if (!signal?.aborted) results.set(key, result)
      return result
    },
  }
}
