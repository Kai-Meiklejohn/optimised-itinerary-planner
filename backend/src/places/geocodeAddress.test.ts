import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { GeoPlacesClient, GeocodeCommand } from '@aws-sdk/client-geo-places'
import { geocodeAddress } from './geocodeAddress.js'

const placesMock = mockClient(GeoPlacesClient)

beforeEach(() => {
  placesMock.reset()
})

describe('geocodeAddress', () => {
  it('returns coordinates for a matched address', async () => {
    placesMock.on(GeocodeCommand).resolves({
      ResultItems: [{ PlaceId: 'place-1', PlaceType: 'PointAddress', Title: 'Kyoto', Position: [135.7727, 34.9671] }],
    })

    const location = await geocodeAddress('68 Fukakusa Yabunouchicho, Kyoto', placesMock as unknown as GeoPlacesClient)

    expect(location).toEqual({ lat: 34.9671, lng: 135.7727 })
  })

  it('returns undefined when the address cannot be matched', async () => {
    placesMock.on(GeocodeCommand).resolves({ ResultItems: [] })

    const location = await geocodeAddress('not a real place', placesMock as unknown as GeoPlacesClient)

    expect(location).toBeUndefined()
  })

  it('requests Storage intended use, since the result is persisted to DynamoDB rather than used once', async () => {
    placesMock.on(GeocodeCommand).resolves({
      ResultItems: [{ PlaceId: 'place-1', PlaceType: 'PointAddress', Title: 'Kyoto', Position: [135.7727, 34.9671] }],
    })

    await geocodeAddress('68 Fukakusa Yabunouchicho, Kyoto', placesMock as unknown as GeoPlacesClient)

    const call = placesMock.commandCalls(GeocodeCommand)[0].args[0].input
    expect(call.IntendedUse).toBe('Storage')
    expect(call.Language).toBe('en')
  })
})
