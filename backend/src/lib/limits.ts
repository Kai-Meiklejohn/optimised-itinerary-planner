export const MAX_TRIP_DAYS = 60
export const MAX_TRIP_NAME_LENGTH = 200
export const MAX_TRIP_DESTINATION_LENGTH = 200
export const MAX_EMAIL_LENGTH = 254
export const MAX_DISPLAY_NAME_LENGTH = 100
export const MAX_NOTES_LENGTH = 2000
export const MAX_ADDRESS_LENGTH = 300
export const MAX_PLACE_NAME_LENGTH = 200
export const MAX_DESTINATION_QUERY_LENGTH = 200
export const MAX_VISIT_DURATION_MINUTES = 1440
export const MIN_PRIORITY = 1
export const MAX_PRIORITY = 5

// Real stopIds are UUIDs (36 chars) generated server-side - this is a
// generous cap, not a realistic value, just enough to reject an oversized
// value before it reaches a DynamoDB key attribute (which has its own,
// much stricter 2048-byte limit and would otherwise surface as an
// unhandled 500 instead of a clean validation error).
export const MAX_STOP_ID_LENGTH = 100

// Bounds how often one user can trigger a billable Amazon Location Places API
// call (GetPlace/Geocode/Suggest, all made server-side against the team's
// shared AWS account) via stop creation.
export const MAX_PLACE_REQUESTS_PER_WINDOW = 20
export const PLACE_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 60
