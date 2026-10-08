import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { GeoPlacesClient, GeocodeCommand, SuggestCommand } from '@aws-sdk/client-geo-places'
import { resolvePlaceId } from './resolvePlaceId.js'

const placesMock = mockClient(GeoPlacesClient)

beforeEach(() => {
  placesMock.reset()
})

describe('resolvePlaceId', () => {
  it('geocodes the destination, then uses it to bias the search', async () => {
    placesMock.on(GeocodeCommand).resolves({
      ResultItems: [{ PlaceId: 'dest-1', PlaceType: 'Locality', Title: 'Kyoto', Position: [135.7681, 35.0116] }],
    })
    placesMock.on(SuggestCommand).resolves({
      PricingBucket: 'Core',
      ResultItems: [
        { Title: 'Fushimi Inari Taisha', SuggestResultItemType: 'Place', Place: { PlaceId: 'place-123' } },
      ],
    })

    const placeId = await resolvePlaceId('Fushimi Inari', 'Kyoto, Japan', placesMock as unknown as GeoPlacesClient)

    expect(placeId).toBe('place-123')
    expect(placesMock.commandCalls(SuggestCommand)[0].args[0].input.Language).toBe('en')
    expect(placesMock.commandCalls(GeocodeCommand)[0].args[0].input.Language).toBe('en')
    expect(placesMock.commandCalls(SuggestCommand)[0].args[0].input.BiasPosition).toEqual([135.7681, 35.0116])
  })

  it('geocodes the selected address, not just the destination, so the bias is street-level and picks the same branch the user selected', async () => {
    placesMock.on(GeocodeCommand).resolves({
      ResultItems: [{ PlaceId: 'addr-1', PlaceType: 'PointAddress', Title: 'Newmarket, Auckland', Position: [174.7773, -36.8695] }],
    })
    placesMock.on(SuggestCommand).resolves({
      PricingBucket: 'Core',
      ResultItems: [
        { Title: 'Starbucks - Newmarket', SuggestResultItemType: 'Place', Place: { PlaceId: 'place-newmarket' } },
      ],
    })

    const placeId = await resolvePlaceId(
      'Starbucks',
      'Auckland, New Zealand',
      placesMock as unknown as GeoPlacesClient,
      '277 Broadway, Newmarket, Auckland',
    )

    expect(placeId).toBe('place-newmarket')
    expect(placesMock.commandCalls(GeocodeCommand)[0].args[0].input.QueryText).toBe('277 Broadway, Newmarket, Auckland')
    expect(placesMock.commandCalls(SuggestCommand)[0].args[0].input.BiasPosition).toEqual([174.7773, -36.8695])
  })

  it('throws when the destination cannot be geocoded', async () => {
    placesMock.on(GeocodeCommand).resolves({ ResultItems: [] })

    await expect(
      resolvePlaceId('Fushimi Inari', 'Nowhere real', placesMock as unknown as GeoPlacesClient),
    ).rejects.toThrow('Could not determine a location')
  })

  it('throws when no place matches the query', async () => {
    placesMock.on(GeocodeCommand).resolves({
      ResultItems: [{ PlaceId: 'dest-1', PlaceType: 'Locality', Title: 'Kyoto', Position: [135.7681, 35.0116] }],
    })
    placesMock.on(SuggestCommand).resolves({ PricingBucket: 'Core', ResultItems: [] })

    await expect(
      resolvePlaceId('asdkjhaskjdh', 'Kyoto, Japan', placesMock as unknown as GeoPlacesClient),
    ).rejects.toThrow('No place found')
  })
})
