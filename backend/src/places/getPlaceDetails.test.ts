import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { GeoPlacesClient, GetPlaceCommand } from '@aws-sdk/client-geo-places'
import { getPlaceDetails } from './getPlaceDetails.js'

const placesMock = mockClient(GeoPlacesClient)

beforeEach(() => {
  placesMock.reset()
})

describe('getPlaceDetails', () => {
  it('normalizes a full response, converting [lng, lat] to {lat, lng}', async () => {
    placesMock.on(GetPlaceCommand).resolves({
      PlaceId: 'place-123',
      PlaceType: 'PointOfInterest',
      Title: 'Fushimi Inari Taisha',
      PricingBucket: 'Core',
      Address: { Label: 'Kyoto, Japan' },
      Position: [135.7727, 34.9671],
      Categories: [{ Id: 'cat-1', Name: 'Shrine' }],
    })

    const details = await getPlaceDetails('place-123', placesMock as unknown as GeoPlacesClient)

    expect(details).toEqual({
      placeId: 'place-123',
      name: 'Fushimi Inari Taisha',
      address: 'Kyoto, Japan',
      location: { lat: 34.9671, lng: 135.7727 },
      categories: ['Shrine'],
    })
  })

  it('requests IntendedUse: Storage, since the result gets persisted as a Stop', async () => {
    placesMock.on(GetPlaceCommand).resolves({
      PlaceId: 'p',
      PlaceType: 'PointOfInterest',
      Title: 'X',
      PricingBucket: 'Core',
    })

    await getPlaceDetails('p', placesMock as unknown as GeoPlacesClient)

    expect(placesMock.commandCalls(GetPlaceCommand)[0].args[0].input.IntendedUse).toBe('Storage')
  })

  it('handles a missing position gracefully instead of crashing', async () => {
    placesMock.on(GetPlaceCommand).resolves({
      PlaceId: 'p',
      PlaceType: 'PointOfInterest',
      Title: 'X',
      PricingBucket: 'Core',
    })

    const details = await getPlaceDetails('p', placesMock as unknown as GeoPlacesClient)

    expect(details.location).toBeUndefined()
  })
})

it('requests English while preserving the provider fallback name', async () => {
  placesMock.on(GetPlaceCommand).resolves({
    PlaceId: 'p', PlaceType: 'PointOfInterest', Title: '東京スカイツリー', PricingBucket: 'Core',
  })
  const details = await getPlaceDetails('p', placesMock as unknown as GeoPlacesClient)
  expect(placesMock.commandCalls(GetPlaceCommand)[0].args[0].input.Language).toBe('en')
  expect(details.name).toBe('東京スカイツリー')
})

it.each(['Tokyo Skytree', 'Eiffel Tower', 'Egyptian Museum', 'Seoul Station', 'São Paulo Café', '小さな神社'])('keeps the provider name %s without attempting its own translation', async (name) => {
  placesMock.on(GetPlaceCommand).resolves({ PlaceId: 'p', Title: name })
  expect((await getPlaceDetails('p', placesMock as unknown as GeoPlacesClient)).name).toBe(name)
  expect(placesMock.commandCalls(GetPlaceCommand)[0].args[0].input.Language).toBe('en')
})
