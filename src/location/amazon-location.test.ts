import { describe, expect, it, vi } from 'vitest'

import {
  AmazonLocationRequestError,
  createAmazonLocationPlacesGateway,
  getAmazonLocationConfig,
  getLegacyMapStyleUrl,
} from './amazon-location'

const config = {
  apiKey: 'test-public-key',
  region: 'us-east-1',
  mapName: 'itinerary-planner-map',
  placeIndexName: 'itinerary-planner-places',
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

describe('Amazon Location configuration', () => {
  it('returns null until every required browser value is configured', () => {
    expect(getAmazonLocationConfig({})).toBeNull()
    expect(getAmazonLocationConfig({ VITE_AWS_LOCATION_API_KEY: '  ' })).toBeNull()
  })

  it('trims browser configuration and builds the legacy map style URL', () => {
    const result = getAmazonLocationConfig({
      VITE_AWS_LOCATION_API_KEY: ' test-public-key ',
      VITE_AWS_REGION: ' us-east-1 ',
      VITE_LOCATION_MAP_NAME: ' itinerary-planner-map ',
      VITE_LOCATION_PLACE_INDEX_NAME: ' itinerary-planner-places ',
    })

    expect(result).toEqual(config)
    expect(getLegacyMapStyleUrl(config)).toBe(
      'https://maps.geo.us-east-1.amazonaws.com/maps/v0/maps/itinerary-planner-map/style-descriptor?key=test-public-key',
    )
  })
})

describe('Amazon Location legacy Places gateway', () => {
  it('requests suggestions with an optional geographic bias and normalizes the response', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      Results: [
        { Text: 'Fushimi Inari Taisha, Kyoto, Japan', PlaceId: 'place-1', Categories: ['Tourist Attraction'] },
        { Text: 'Fushimi Ward, Kyoto, Japan' },
      ],
    }))
    const gateway = createAmazonLocationPlacesGateway(config, fetcher)

    await expect(gateway.suggest('Fushimi', {
      biasPosition: { lat: 35.01, lng: 135.76 },
    })).resolves.toEqual([
      {
        id: 'place-1',
        placeId: 'place-1',
        text: 'Fushimi Inari Taisha, Kyoto, Japan',
        categories: ['Tourist Attraction'],
      },
      {
        id: 'Fushimi Ward, Kyoto, Japan',
        text: 'Fushimi Ward, Kyoto, Japan',
        categories: [],
      },
    ])

    expect(fetcher).toHaveBeenCalledWith(
      'https://places.geo.us-east-1.amazonaws.com/places/v0/indexes/itinerary-planner-places/search/suggestions?key=test-public-key',
      expect.objectContaining({
        body: JSON.stringify({
          Text: 'Fushimi',
          MaxResults: 6,
          Language: 'en',
          BiasPosition: [135.76, 35.01],
        }),
        method: 'POST',
      }),
    )
  })

  it('resolves a suggestion by matching its PlaceId and converts longitude-latitude order', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      Results: [
        {
          PlaceId: 'wrong-place',
          Place: {
            Label: 'Fushimi Ward, Kyoto, Japan',
            Geometry: { Point: [135.75, 34.94] },
          },
        },
        {
          PlaceId: 'place-1',
          Place: {
            Label: 'Fushimi Inari Taisha, 68 Fukakusa Yabunouchicho, Kyoto, Japan',
            Geometry: { Point: [135.7727, 34.9671] },
            Categories: ['Tourist Attraction'],
          },
        },
      ],
    }))
    const gateway = createAmazonLocationPlacesGateway(config, fetcher)

    await expect(gateway.resolve({
      id: 'place-1',
      placeId: 'place-1',
      text: 'Fushimi Inari Taisha, Kyoto, Japan',
      categories: ['Tourist Attraction'],
    })).resolves.toEqual({
      placeId: 'place-1',
      name: 'Fushimi Inari Taisha',
      address: 'Fushimi Inari Taisha, 68 Fukakusa Yabunouchicho, Kyoto, Japan',
      category: 'Attraction',
      location: { lat: 34.9671, lng: 135.7727 },
      provider: 'amazon-location',
      region: 'us-east-1',
    })
  })

  it('does not silently substitute a different place when a provider ID cannot be matched', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      Results: [
        {
          PlaceId: 'different-place',
          Place: {
            Label: 'A different attraction, Kyoto, Japan',
            Geometry: { Point: [135.7, 35] },
          },
        },
      ],
    }))
    const gateway = createAmazonLocationPlacesGateway(config, fetcher)

    await expect(gateway.resolve({
      id: 'requested-place',
      placeId: 'requested-place',
      text: 'Requested attraction, Kyoto, Japan',
      categories: ['Tourist Attraction'],
    })).rejects.toMatchObject({ code: 'incomplete-result' })
  })

  it('accepts an exact label match when Esri text search omits the suggestion PlaceId', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      Results: [{
        Place: {
          Label: 'Fushimi Inari Otabisho, Minami, Kyoto, JPN',
          Geometry: { Point: [135.7533, 34.9827] },
          Categories: ['Shrine'],
        },
      }],
    }))
    const gateway = createAmazonLocationPlacesGateway(config, fetcher)

    await expect(gateway.resolve({
      id: 'provider-suggestion-id',
      placeId: 'provider-suggestion-id',
      text: '  Fushimi Inari Otabisho, Minami, Kyoto, JPN  ',
      categories: [],
    })).resolves.toMatchObject({
      address: 'Fushimi Inari Otabisho, Minami, Kyoto, JPN',
      location: { lat: 34.9827, lng: 135.7533 },
      placeId: 'provider-suggestion-id',
    })
  })

  it('uses place text as a category fallback when Esri omits useful categories', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      Results: [{
        PlaceId: 'fushimi-place',
        Place: {
          Label: 'Fushimi Inari-taisha, Fushimi Ku, Kyoto, JPN',
          Geometry: { Point: [135.7727, 34.9671] },
          Categories: [],
        },
      }],
    }))
    const gateway = createAmazonLocationPlacesGateway(config, fetcher)

    await expect(gateway.resolve({
      id: 'fushimi-place',
      placeId: 'fushimi-place',
      text: 'Fushimi Inari-taisha, Kyoto, Japan',
      categories: [],
    })).resolves.toMatchObject({ category: 'Attraction' })
  })

  it('rejects incomplete results without coordinates and does not expose provider response text', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ Results: [{ Place: { Label: 'Unknown place' } }] }))
    const gateway = createAmazonLocationPlacesGateway(config, fetcher)

    await expect(gateway.resolve({
      id: 'unknown',
      text: 'Unknown place',
      categories: [],
    })).rejects.toMatchObject({ code: 'incomplete-result' })

    fetcher.mockResolvedValueOnce(jsonResponse({ message: 'API key test-public-key is forbidden' }, 403))
    await expect(gateway.suggest('Fushimi')).rejects.toEqual(
      new AmazonLocationRequestError('access-denied', 'Place search is not available for this website.'),
    )
  })
})
