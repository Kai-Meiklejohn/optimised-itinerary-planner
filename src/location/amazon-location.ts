import type { ActivityCategory, Coordinates } from '@/itinerary'
import { amazonPositionToCoordinates } from '@/map/itinerary-map-model'

export type AmazonLocationConfig = {
  apiKey: string
  region: string
  mapName: string
  placeIndexName: string
}

export type PlaceSuggestion = {
  id: string
  text: string
  placeId?: string
  categories: string[]
}

export type ResolvedPlace = {
  backendPlaceId?: string
  placeId?: string
  name: string
  address: string
  category: ActivityCategory
  location?: Coordinates
  provider: 'amazon-location'
  region: string
}

export type PlaceSearchOptions = {
  biasPosition?: Coordinates
  signal?: AbortSignal
}

export type PlacesGateway = {
  suggest: (query: string, options?: PlaceSearchOptions) => Promise<PlaceSuggestion[]>
  resolve: (suggestion: PlaceSuggestion, options?: PlaceSearchOptions) => Promise<ResolvedPlace>
}

export type AmazonLocationErrorCode =
  | 'access-denied'
  | 'incomplete-result'
  | 'not-found'
  | 'throttled'
  | 'unavailable'
  | 'validation'

export class AmazonLocationRequestError extends Error {
  readonly code: AmazonLocationErrorCode

  constructor(code: AmazonLocationErrorCode, message: string) {
    super(message)
    this.name = 'AmazonLocationRequestError'
    this.code = code
  }
}

type Environment = Record<string, string | boolean | undefined>
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type LegacySuggestionResponse = {
  Results?: Array<{
    Text?: string
    PlaceId?: string
    Categories?: string[]
  }>
}

type LegacyTextSearchResponse = {
  Results?: Array<{
    PlaceId?: string
    Place?: {
      Label?: string
      Categories?: string[]
      Geometry?: { Point?: number[] }
    }
  }>
}

function readEnvironmentValue(environment: Environment, name: string) {
  const value = environment[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function getAmazonLocationConfig(environment: Environment = import.meta.env) : AmazonLocationConfig | null {
  const config = {
    apiKey: readEnvironmentValue(environment, 'VITE_AWS_LOCATION_API_KEY'),
    region: readEnvironmentValue(environment, 'VITE_AWS_REGION'),
    mapName: readEnvironmentValue(environment, 'VITE_LOCATION_MAP_NAME'),
    placeIndexName: readEnvironmentValue(environment, 'VITE_LOCATION_PLACE_INDEX_NAME'),
  }

  return Object.values(config).every(Boolean) ? config : null
}

export function getLegacyMapStyleUrl(config: AmazonLocationConfig) {
  const region = encodeURIComponent(config.region)
  const mapName = encodeURIComponent(config.mapName)
  const key = encodeURIComponent(config.apiKey)
  return `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor?key=${key}`
}

function getPlacesEndpoint(config: AmazonLocationConfig, operation: 'suggestions' | 'text') {
  const region = encodeURIComponent(config.region)
  const indexName = encodeURIComponent(config.placeIndexName)
  const key = encodeURIComponent(config.apiKey)
  return `https://places.geo.${region}.amazonaws.com/places/v0/indexes/${indexName}/search/${operation}?key=${key}`
}

function getRequestError(status: number) {
  if (status === 400) {
    return new AmazonLocationRequestError('validation', 'That search could not be completed. Try different words.')
  }
  if (status === 403) {
    return new AmazonLocationRequestError('access-denied', 'Place search is not available for this website.')
  }
  if (status === 404) {
    return new AmazonLocationRequestError('not-found', 'The configured place search could not be found.')
  }
  if (status === 429) {
    return new AmazonLocationRequestError('throttled', 'Place search is busy. Wait a moment and try again.')
  }
  return new AmazonLocationRequestError('unavailable', 'Place search is temporarily unavailable.')
}

async function postJson<T>(fetcher: Fetcher, url: string, body: Record<string, unknown>, signal?: AbortSignal) {
  let response: Response
  try {
    response = await fetcher(url, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new AmazonLocationRequestError('unavailable', 'Place search is temporarily unavailable.')
  }

  if (!response.ok) {
    throw getRequestError(response.status)
  }

  try {
    return await response.json() as T
  } catch {
    throw new AmazonLocationRequestError('unavailable', 'Place search returned an unreadable response.')
  }
}

function getSearchBody(text: string, options: PlaceSearchOptions, maxResults: number) {
  return {
    Text: text.trim(),
    MaxResults: maxResults,
    Language: 'en',
    ...(options.biasPosition
      ? { BiasPosition: [options.biasPosition.lng, options.biasPosition.lat] }
      : {}),
  }
}

function getActivityCategory(categories: readonly string[]): ActivityCategory {
  const value = categories.join(' ').toLowerCase()
  if (/restaurant|food|cafe|coffee|bakery|bar|market/.test(value)) return 'Food'
  if (/hotel|lodging|accommodation|resort|motel/.test(value)) return 'Stay'
  if (/airport|station|transport|ferry|bus|rail/.test(value)) return 'Transport'
  if (/attraction|museum|monument|park|garden|temple|shrine|taisha|landmark/.test(value)) return 'Attraction'
  return 'Other'
}

function getPlaceName(suggestion: PlaceSuggestion) {
  const firstSegment = suggestion.text.split(',')[0]?.trim()
  return firstSegment || suggestion.text.trim()
}

function normalizePlaceLabel(value: string | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en') ?? ''
}

export function createAmazonLocationPlacesGateway(
  config: AmazonLocationConfig,
  fetcher: Fetcher = fetch,
): PlacesGateway {
  return {
    async suggest(query, options = {}) {
      const response = await postJson<LegacySuggestionResponse>(
        fetcher,
        getPlacesEndpoint(config, 'suggestions'),
        getSearchBody(query, options, 6),
        options.signal,
      )
      const seenIds = new Set<string>()

      return (response.Results ?? []).flatMap((result) => {
        const text = result.Text?.trim()
        if (!text) return []
        const id = result.PlaceId?.trim() || text
        if (seenIds.has(id)) return []
        seenIds.add(id)
        return [{
          id,
          text,
          ...(result.PlaceId?.trim() ? { placeId: result.PlaceId.trim() } : {}),
          categories: result.Categories?.filter(Boolean) ?? [],
        }]
      })
    },

    async resolve(suggestion, options = {}) {
      const response = await postJson<LegacyTextSearchResponse>(
        fetcher,
        getPlacesEndpoint(config, 'text'),
        getSearchBody(suggestion.text, options, 10),
        options.signal,
      )
      const results = response.Results ?? []
      const result = suggestion.placeId
        ? results.find((candidate) => candidate.PlaceId === suggestion.placeId)
          ?? results.find((candidate) => (
            normalizePlaceLabel(candidate.Place?.Label) === normalizePlaceLabel(suggestion.text)
          ))
        : results[0]
      const location = amazonPositionToCoordinates(result?.Place?.Geometry?.Point)
      const address = result?.Place?.Label?.trim()

      if (!result || !location || !address) {
        throw new AmazonLocationRequestError(
          'incomplete-result',
          'That result does not include enough location information. Try another result or enter it manually.',
        )
      }

      const categories = [
        ...(result.Place?.Categories?.filter(Boolean) ?? []),
        ...suggestion.categories,
      ]
      const placeId = result.PlaceId?.trim() || suggestion.placeId?.trim()
      return {
        ...(placeId ? { placeId } : {}),
        name: getPlaceName(suggestion),
        address,
        category: getActivityCategory([...categories, suggestion.text, address]),
        location,
        provider: 'amazon-location',
        region: config.region,
      }
    },
  }
}
