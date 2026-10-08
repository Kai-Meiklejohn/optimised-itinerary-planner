import { GeoPlacesClient, GeocodeCommand, SuggestCommand } from '@aws-sdk/client-geo-places'
import { ValidationError } from '../lib/errors.js'

export async function resolvePlaceId(
  query: string,
  destination: string,
  client: GeoPlacesClient,
  address?: string,
): Promise<string> {
  // Geocoding the specific selected address (when available) gives a street-level bias
  // instead of a city-level one, so a chain business resolves to the same branch the
  // user actually selected rather than just whichever branch is closest to the
  // destination's rough centroid.
  const biasQueryText = address || destination
  const geocodeResult = await client.send(new GeocodeCommand({ QueryText: biasQueryText, Language: 'en' }))
  const biasPosition = geocodeResult.ResultItems?.[0]?.Position

  if (!biasPosition) {
    throw new ValidationError(`Could not determine a location for destination "${destination}"`)
  }

  const suggestResult = await client.send(
    new SuggestCommand({ QueryText: query, Language: 'en', MaxResults: 1, BiasPosition: biasPosition }),
  )

  const placeId = suggestResult.ResultItems?.find((item) => item.Place)?.Place?.PlaceId

  if (!placeId) {
    throw new ValidationError(`No place found matching "${query}" near "${destination}"`)
  }

  return placeId
}
