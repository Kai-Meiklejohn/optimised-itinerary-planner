import { GeoPlacesClient } from '@aws-sdk/client-geo-places'

const region = process.env.AWS_REGION ?? 'us-east-1'

export const placesClient = new GeoPlacesClient({ region })
