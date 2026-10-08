import { GeoPlacesClient, GeocodeCommand } from '@aws-sdk/client-geo-places'

export async function geocodeAddress(
  address: string,
  client: GeoPlacesClient,
): Promise<{ lat: number; lng: number } | undefined> {
  const result = await client.send(new GeocodeCommand({ QueryText: address, IntendedUse: 'Storage', Language: 'en' }))
  const [lng, lat] = result.ResultItems?.[0]?.Position ?? []
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : undefined
}
