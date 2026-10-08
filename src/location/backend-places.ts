import { resolveBackendPlace } from '@/lib/backendApi'
import type { PlacesGateway } from './amazon-location'

// Legacy search IDs cannot be used by Places v2. Resolve once before confirming
// a selection and keep the backend ID separate from the legacy search metadata.
export function withBackendPlaceDetails(legacy: PlacesGateway, tripId: string, destination: string): PlacesGateway {
  return {
    suggest: (query, options) => legacy.suggest(query, options),
    async resolve(suggestion, options) {
      const timeout = AbortSignal.timeout(15_000)
      const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      const selected = await legacy.resolve(suggestion, { ...options, signal })
      signal.throwIfAborted()
      const place = await resolveBackendPlace(tripId, { query: selected.name, destination, address: selected.address }, signal)
      signal.throwIfAborted()
      return { ...selected, name: place.name, address: place.address ?? '', category: place.category,
        location: place.location, backendPlaceId: place.placeId }
    },
  }
}
