import { GeoPlacesClient, GetPlaceCommand } from '@aws-sdk/client-geo-places'

export type PlaceDetails = {
  placeId: string
  name: string
  address?: string
  location?: { lat: number; lng: number }
  categories: string[]
}

export async function getPlaceDetails(
  placeId: string,
  client: GeoPlacesClient,
): Promise<PlaceDetails> {
  const result = await client.send(
    new GetPlaceCommand({ PlaceId: placeId, IntendedUse: 'Storage', Language: 'en' }),
  )

  const [lng, lat] = result.Position ?? []
  const location = typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : undefined

  return {
    placeId: result.PlaceId ?? placeId,
    name: result.Title ?? 'Unknown place',
    address: result.Address?.Label,
    location,
    categories: (result.Categories ?? [])
      .map((category) => category.Name)
      .filter((name): name is string => Boolean(name)),
  }
}
