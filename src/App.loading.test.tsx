import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { restoreSession, signOutUser } from './services/authService'
import { createBackendTrip, listBackendTrips, listBackendStops } from './lib/backendApi'

vi.mock('./services/authService', () => ({
  restoreSession: vi.fn(), signInUser: vi.fn(), signOutUser: vi.fn(), getSessionVersion: () => 0, invalidatePendingSession: vi.fn(),
  signUpUser: vi.fn(), confirmSignUpUser: vi.fn(), resendConfirmationCode: vi.fn(), forgotPassword: vi.fn(), confirmForgotPassword: vi.fn(),
}))
vi.mock('./services/userService', () => ({ createUserProfile: vi.fn() }))
vi.mock('./lib/backendApi', () => ({
  createBackendTrip: vi.fn(), listBackendTrips: vi.fn(), listBackendStops: vi.fn(), deleteBackendTrip: vi.fn(), updateBackendTrip: vi.fn(),
  createBackendStop: vi.fn(), updateBackendStop: vi.fn(), deleteBackendStop: vi.fn(), resolveBackendPlace: vi.fn(),
}))

const savedTrip = { tripId: 'saved-trip', userId: 'user-1', name: 'Already saved trip', destination: 'Tokyo', startDate: '2027-09-10', endDate: '2027-09-12' }
beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  vi.mocked(signOutUser).mockImplementation(async () => localStorage.clear())
  vi.mocked(listBackendTrips).mockResolvedValue([savedTrip])
  vi.mocked(listBackendStops).mockResolvedValue([])
  localStorage.setItem('refreshToken', 'test-refresh')
  vi.mocked(restoreSession).mockResolvedValue({ idToken: `header.${btoa(JSON.stringify({sub:'user-1',name:'Kai'}))}.signature`, accessToken:'test-access',refreshToken:'test-refresh' })
})

const savedStop = { tripId: 'saved-trip', stopId: 'stop-1', placeId: 'place-1', placeName: 'Saved museum', category: 'Attraction' as const, visitDurationMinutes: 60, priority: 3, date: '2027-09-10' }

it.each([false, true])('preserves a new trip when the delayed list includes it: %s', async (includesCreatedTrip) => {
  let finishList!: (trips: typeof savedTrip[]) => void
  vi.mocked(listBackendTrips).mockReturnValue(new Promise(resolve => { finishList = resolve }))
  const createdTrip = { ...savedTrip, tripId: 'created-trip', name: 'Newly created trip' }
  vi.mocked(createBackendTrip).mockResolvedValue(createdTrip)
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('button', {name:'Create itinerary'}))
  const form = screen.getByRole('form', {name:'Create itinerary'})
  await user.type(within(form).getByLabelText('Trip name'), 'Newly created trip')
  await user.type(within(form).getByLabelText('Main destination'), 'Tokyo')
  await user.type(within(form).getByLabelText('Start date'), '2027-09-10')
  await user.type(within(form).getByLabelText('End date'), '2027-09-12')
  await user.click(within(form).getByRole('button', {name:'Add itinerary'}))
  expect(await screen.findByRole('heading', {name:'Newly created trip'})).toBeInTheDocument()
  await act(async () => finishList(includesCreatedTrip ? [savedTrip, createdTrip] : [savedTrip]))
  expect(screen.getByRole('heading', {name:'Newly created trip'})).toBeInTheDocument()
  expect(screen.queryByRole('form', {name:'Sign in'})).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', {name:'Back to itineraries'}))
  expect(screen.getAllByRole('button', {name:'Open Newly created trip'})).toHaveLength(1)
  expect(screen.getByRole('button', {name:'Open Already saved trip'})).toBeInTheDocument()
})

it('shows an activity load error and retries before allowing edits', async () => {
  vi.mocked(listBackendStops).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue([savedStop])
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('button', {name:'Open Already saved trip'}))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this itinerary's places")
  expect(screen.queryByText('Nothing planned for this day yet')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', {name:'Add a place'})).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', {name:'Try again'}))
  expect(await screen.findByRole('heading', {name:'Saved museum'})).toBeInTheDocument()
  expect(screen.getByRole('button', {name:'Add a place'})).toBeEnabled()
  await user.click(screen.getByRole('button', {name:'Back to itineraries'}))
  await user.click(screen.getByRole('button', {name:'Open Already saved trip'}))
  expect(screen.getByRole('heading', {name:'Saved museum'})).toBeInTheDocument()
  expect(listBackendStops).toHaveBeenCalledTimes(2)
})

it('loads accurate counts on every restored dashboard without opening a trip', async () => {
  vi.mocked(listBackendStops).mockResolvedValue([savedStop])
  for (let reload = 0; reload < 2; reload++) {
    render(<App />)
    const card = await screen.findByRole('button', {name:'Open Already saved trip'})
    expect(await within(card).findByText('1 place')).toBeInTheDocument()
    expect(within(card).getByText('Planning')).toBeInTheDocument()
    expect(within(screen.getByRole('region', {name:'Itinerary overview'})).getByText('Planned places').previousElementSibling).toHaveTextContent('1')
    cleanup()
  }
  expect(listBackendStops).toHaveBeenCalledTimes(2)
})

it('distinguishes pending places from an empty itinerary and loads all days in saved order', async () => {
  let finish!: (stops: typeof savedStop[]) => void
  vi.mocked(listBackendStops).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const user = userEvent.setup()
  render(<App />)
  const card = await screen.findByRole('button', {name:'Open Already saved trip'})
  expect(within(card).queryByText('0 places')).not.toBeInTheDocument()
  expect(within(card).getByText('Loading places…')).toBeInTheDocument()
  await user.click(card)
  expect(screen.getByRole('status')).toHaveTextContent('Loading places')
  expect(screen.queryByRole('button', {name:'Add a place'})).not.toBeInTheDocument()
  await act(async () => finish([savedStop, {...savedStop, stopId:'stop-2',placeName:'Second museum'}, {...savedStop,stopId:'stop-3',placeName:'Next day',date:'2027-09-11'}]))
  expect(screen.getAllByRole('article').map(article => article.getAttribute('aria-label'))).toEqual(['Saved museum','Second museum'])
  await user.click(screen.getByRole('button', {name:/Day 2/}))
  expect(screen.getByRole('heading', {name:'Next day'})).toBeInTheDocument()
})

it('shows unavailable totals for partial failures and keeps other trips usable', async () => {
  vi.mocked(listBackendTrips).mockResolvedValue([savedTrip, {...savedTrip,tripId:'empty',name:'Empty trip'}])
  vi.mocked(listBackendStops).mockImplementation(async id => {
    if (id === 'saved-trip') throw new Error('Temporary failure')
    return []
  })
  const user = userEvent.setup()
  render(<App />)
  const failed = await screen.findByRole('button', {name:'Open Already saved trip'})
  expect(await within(failed).findByText('Places unavailable')).toBeInTheDocument()
  expect(within(screen.getByRole('region', {name:'Itinerary overview'})).getByText('Planned places').previousElementSibling).toHaveTextContent('Unavailable')
  const empty = screen.getByRole('button', {name:'Open Empty trip'})
  expect(within(empty).getByText('0 places')).toBeInTheDocument()
  await user.click(empty)
  expect(screen.getByText('Nothing planned for this day yet')).toBeInTheDocument()
  await user.click(screen.getByRole('button', {name:'Back to itineraries'}))
  await user.click(screen.getByRole('button', {name:'Open Empty trip'}))
  expect(listBackendStops).toHaveBeenCalledTimes(2)
})

it('discards pending place loads after logout', async () => {
  let finish!: (stops: typeof savedStop[]) => void
  vi.mocked(listBackendStops).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', {name:'Open Already saved trip'})
  await user.click(screen.getByRole('button', {name:'Sign out'}))
  await act(async () => finish([savedStop]))
  expect(screen.getByRole('form', {name:'Sign in'})).toBeInTheDocument()
  expect(screen.queryByText('Saved museum')).not.toBeInTheDocument()
})
