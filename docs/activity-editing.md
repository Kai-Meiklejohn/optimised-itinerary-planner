# Activity selection and editing

## Contract

`POST /trips/{tripId}/stops/resolve` takes `query`, `destination` and optional
`address`. It checks the caller owns the trip, validates the input and applies the
existing per-user Places request limit. The server resolves the legacy selection
through Places v2 and returns `placeId`, `name`, `address`, `location`, `categories`
and the suggested application `category`. It does not create a Stop row.

The browser keeps this authoritative ID separately as `backendPlaceId`. Create and
replacement requests use this ID, so saving does not search for another matching POI.
The server still fetches provider details when writing rather than trusting browser
supplied names or coordinates. Category and address confirmed in the form take priority.

`PATCH /trips/{tripId}/stops/{stopId}` supports partial updates to `category`, `time`,
`visitDurationMinutes`, `address`, `notes` and `placeId`. It also accepts
`previousStopId` and `nextStopId` for reordering within a day. Reordering changes
the saved order without changing activity times. Neighbour checks reject stale
concurrent moves. A replacement ID refreshes the
provider name and coordinates in the same DynamoDB update. An explicitly supplied address refreshes its coordinates through Places Geocode, unless
it matches the replacement place’s provider address. Clearing an address also removes
its coordinates. No match saves the address without a pin; a provider error fails the
whole save. The frontend omits unchanged addresses on ordinary edits, preserving
coordinates without a lookup. Nonblank address updates use the existing Places rate
limit. The same address rules apply when confirming a new selected place.
Empty time or notes clears that field. Duration must be within 1–1440 minutes.
Unknown category values are rejected. Missing stops cannot be recreated by editing.

Frontend selection waits are bounded to 15 seconds. Changing the search or cancelling
aborts the browser request and ignores obsolete results. Aborting cannot undo AWS calls
that have already reached the server. Save locks fields and competing stop actions. An open editor also respects a pending
deletion. Switching from Edit to Add discards the old replacement preview.

## Existing records

There is no background migration. To refresh an older localised name, explicitly
reselect the same place in Edit and save. Review the suggested category and address
before confirming. English is a preferred provider language, not a translation
service, and AWS may retain an original-language name when English is unavailable.

## Activity scheduling

Add and Edit check the proposed interval against every day, excluding the edited
activity itself. Date offsets use calendar dates and wall-clock minutes, independent
of the browser time zone. Exact end/start boundaries are allowed, but partial overlap,
containment and midnight overlap are rejected. An activity without a start time does
not reserve an interval. Travel estimates are not part of this check.

The backend validates scheduled creates and time/duration updates using strongly
consistent, paginated stop reads. A reserved `#order#schedule` row stores a per-trip
revision. Read the revision before scanning stops, then conditionally advance it in
the same DynamoDB transaction as the stop write. A simultaneous scheduling write
invalidates the snapshot and rejects the entire change. This uses the existing Stop
table and transaction permissions. The metadata is hidden by the existing reserved-row
filter and removed with the trip. Timing edits incur a consistent scan of the trip's
stops and a transactional write. Ordinary category/notes-only API edits retain their
single-item update path. Existing rows require no migration, and existing overlaps
are not silently rescheduled.
