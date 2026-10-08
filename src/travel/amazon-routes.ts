import type { Coordinates, TravelMode } from '@/itinerary'
import { isValidCoordinates } from '@/map/itinerary-map-model'

export type GroundTravelMode = Exclude<TravelMode, 'flying' | 'other'>
export type TravelEstimate = { durationSeconds: number }
export type RoutesGateway = {
  estimate: (from: Coordinates, to: Coordinates, mode: GroundTravelMode, signal?: AbortSignal) => Promise<TravelEstimate>
}
type RoutesConfig = { apiKey: string; region: string }
type Environment = Record<string, string | boolean | undefined>

export class RoutesRequestError extends Error {}

export function getAmazonRoutesConfig(environment: Environment = import.meta.env): RoutesConfig | null {
  const key = environment.VITE_AWS_ROUTES_API_KEY
  const region = environment.VITE_AWS_REGION
  const apiKey = typeof key === 'string' ? key.trim() : ''
  // Routing is pinned to the team's deployed, permitted region.
  return apiKey && typeof region === 'string' && region.trim() === 'us-east-1'
    ? { apiKey, region: region.trim() } : null
}

export function createAmazonRoutesGateway(config: RoutesConfig, fetcher: typeof fetch = fetch): RoutesGateway {
  const modes = { driving: 'Car', walking: 'Pedestrian', transit: 'Transit' } as const
  const unavailable = 'Travel estimates are temporarily unavailable.'
  const noRoute = 'No usable route was found for this transport mode.'

  return {
    async estimate(from, to, mode, signal) {
      if (!isValidCoordinates(from) || !isValidCoordinates(to)) {
        throw new RoutesRequestError('Both places need valid coordinates for a route estimate.')
      }
      let response: Response
      try {
        response = await fetcher(`https://routes.geo.${encodeURIComponent(config.region)}.amazonaws.com/v2/routes?key=${encodeURIComponent(config.apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ Origin: [from.lng, from.lat], Destination: [to.lng, to.lat], TravelMode: modes[mode], DepartNow: true, MaxAlternatives: 0 }),
        })
      } catch {
        throw new RoutesRequestError(unavailable)
      }
      if (!response.ok) {
        throw new RoutesRequestError(response.status === 403 ? 'Routing is not authorised for this website. Ask the infrastructure owner to check the routing key.'
          : response.status === 429 ? 'Travel estimates are busy. Wait a moment before trying again.'
            : response.status === 400 || response.status === 404 ? noRoute : unavailable)
      }
      let body: { Routes?: Array<{ Summary?: { Duration?: unknown } }> } | null
      try {
        body = await response.json()
      } catch {
        throw new RoutesRequestError(noRoute)
      }
      const duration = Array.isArray(body?.Routes) ? body.Routes[0]?.Summary?.Duration : undefined
      if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 4294967295) {
        throw new RoutesRequestError(noRoute)
      }
      return { durationSeconds: duration }
    },
  }
}
