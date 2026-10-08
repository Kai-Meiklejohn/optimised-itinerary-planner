import { StrictMode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { restoreSession, signInUser, signOutUser } from './services/authService'
import { createBackendTrip, listBackendStops, listBackendTrips } from './lib/backendApi'

vi.mock('./services/authService', () => ({
  restoreSession: vi.fn(), signInUser: vi.fn(), signOutUser: vi.fn(), getSessionVersion: () => 0, invalidatePendingSession: vi.fn(),
  signUpUser: vi.fn(), confirmSignUpUser: vi.fn(), resendConfirmationCode: vi.fn(),
  forgotPassword: vi.fn(), confirmForgotPassword: vi.fn(),
}))
vi.mock('./services/userService', () => ({ createUserProfile: vi.fn().mockResolvedValue({}) }))
vi.mock('./lib/backendApi', () => ({
  listBackendTrips: vi.fn(), listBackendStops: vi.fn(), createBackendTrip: vi.fn(),
  deleteBackendTrip: vi.fn(), updateBackendTrip: vi.fn(),
}))

function tokens(name?: string, userId = 'user-1') {
  const bytes = new TextEncoder().encode(JSON.stringify({ sub: userId, name }))
  const body = btoa(String.fromCharCode(...bytes))
  return { idToken: `header.${body}.signature`, accessToken: 'access', refreshToken: 'refresh' }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(restoreSession).mockResolvedValue(null)
  vi.mocked(signInUser).mockResolvedValue(tokens('Kai Meiklejohn'))
  vi.mocked(listBackendTrips).mockResolvedValue([])
})

it.each([['Kai Meiklejohn', 'Kai'], ['Zoë Smith', 'Zoë'], [undefined, 'Traveller']])('uses the saved name %s instead of the email username', async (name, greeting) => {
  vi.mocked(signInUser).mockResolvedValue(tokens(name))
  const user = userEvent.setup()
  render(<App />)
  const form = screen.getByRole('form', { name: 'Sign in' })
  await user.type(within(form).getByLabelText('Email address'), 'not-my-name@example.com')
  await user.type(within(form).getByLabelText('Password'), 'password')
  await user.click(within(form).getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByText(`Welcome, ${greeting}`)).toBeInTheDocument()
  expect(screen.queryByText('Welcome, Not-my-name')).not.toBeInTheDocument()
})

it('restores the account after reload and reloads its saved trips', async () => {
  localStorage.setItem('refreshToken', 'refresh')
  vi.mocked(restoreSession).mockResolvedValue(tokens('Kai Meiklejohn'))
  render(<StrictMode><App /></StrictMode>)
  expect(await screen.findByText('Welcome, Kai')).toBeInTheDocument()
  expect(listBackendTrips).toHaveBeenCalledWith('user-1')
  expect(signInUser).not.toHaveBeenCalled()
})

it('does not show private data while session validation is pending', async () => {
  localStorage.setItem('refreshToken', 'refresh')
  vi.mocked(restoreSession).mockReturnValue(new Promise(() => {}))
  render(<App />)
  expect(screen.getByRole('status')).toHaveTextContent('Restoring your session')
  expect(screen.queryByText('Your itinerary projects')).not.toBeInTheDocument()
  expect(listBackendTrips).not.toHaveBeenCalled()
})

it('offers retry after a temporary restoration failure', async () => {
  localStorage.setItem('refreshToken', 'refresh')
  vi.mocked(restoreSession).mockRejectedValueOnce(new Error('Network offline')).mockResolvedValue(tokens('Kai'))
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't restore your session")
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Welcome, Kai')).toBeInTheDocument()
})

it('returns to sign-in when Cognito rejects the saved session', async () => {
  localStorage.setItem('refreshToken', 'revoked')
  render(<App />)
  expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  expect(listBackendTrips).not.toHaveBeenCalled()
})

it('clears private UI when another tab signs out', async () => {
  localStorage.setItem('refreshToken', 'refresh')
  vi.mocked(restoreSession).mockResolvedValue(tokens('Kai'))
  render(<App />)
  await screen.findByText('Welcome, Kai')
  act(() => {
    localStorage.removeItem('refreshToken')
    window.dispatchEvent(new StorageEvent('storage', { key: 'refreshToken', newValue: null }))
  })
  expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.queryByText('Welcome, Kai')).not.toBeInTheDocument()
})

it('does not reopen the dashboard after cancelling a pending restoration', async () => {
  localStorage.setItem('refreshToken', 'refresh')
  let finish!: (value: ReturnType<typeof tokens>) => void
  vi.mocked(restoreSession).mockReturnValue(new Promise(resolve => { finish = resolve }))
  vi.mocked(signOutUser).mockImplementation(async () => localStorage.clear())
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  await act(async () => finish(tokens('Kai')))
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  expect(listBackendTrips).not.toHaveBeenCalled()
})

async function submitTrip(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create itinerary' }))
  const form = screen.getByRole('form', { name: 'Create itinerary' })
  await user.type(within(form).getByLabelText('Trip name'), 'Private family trip')
  await user.type(within(form).getByLabelText('Main destination'), 'Wellington')
  await user.type(within(form).getByLabelText('Start date'), '2027-09-10')
  await user.type(within(form).getByLabelText('End date'), '2027-09-12')
  await user.click(within(form).getByRole('button', { name: 'Add itinerary' }))
  return form
}

it.each(['logout', 'account switch'])('discards pending trip creation after another tab performs %s', async (change) => {
  localStorage.setItem('refreshToken', 'refresh')
  vi.mocked(restoreSession).mockResolvedValue(tokens('Kai'))
  let fail!: (error: Error) => void
  vi.mocked(createBackendTrip).mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))
  const user = userEvent.setup()
  render(<App />)
  await screen.findByText('Welcome, Kai')
  await submitTrip(user)
  expect(createBackendTrip).toHaveBeenCalledOnce()
  vi.mocked(restoreSession).mockResolvedValue(tokens('Alex', 'user-2'))
  act(() => {
    if (change === 'logout') localStorage.removeItem('refreshToken')
    else localStorage.setItem('refreshToken', 'second-account')
    window.dispatchEvent(new StorageEvent('storage', { key: 'refreshToken' }))
  })
  if (change === 'logout') await screen.findByRole('form', { name: 'Sign in' })
  else await screen.findByText('Welcome, Alex')
  await act(async () => fail(new Error('Session changed. Please sign in again.')))
  expect(screen.queryByRole('heading', { name: 'Private family trip' })).not.toBeInTheDocument()
  if (change === 'logout') expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  else expect(screen.getByText('Welcome, Alex')).toBeInTheDocument()
})

it('keeps a failed trip creation in the form and allows retry without a phantom itinerary', async () => {
  localStorage.setItem('refreshToken', 'refresh')
  vi.mocked(restoreSession).mockResolvedValue(tokens('Kai'))
  vi.mocked(createBackendTrip).mockRejectedValueOnce(new Error('Network unavailable'))
  const user = userEvent.setup()
  render(<App />)
  await screen.findByText('Welcome, Kai')
  const form = await submitTrip(user)
  expect(await within(form).findByRole('alert')).toHaveTextContent('Could not create the itinerary')
  expect(within(form).getByLabelText('Trip name')).toHaveValue('Private family trip')
  expect(within(form).getByRole('button', { name: 'Add itinerary' })).toBeEnabled()
  expect(screen.queryByRole('heading', { name: 'Build your itinerary' })).not.toBeInTheDocument()
  vi.mocked(createBackendTrip).mockResolvedValue({ tripId: 'saved-trip', userId: 'user-1', name: 'Private family trip', destination: 'Wellington', startDate: '2027-09-10', endDate: '2027-09-12' })
  await user.click(within(form).getByRole('button', { name: 'Add itinerary' }))
  expect(await screen.findByRole('heading', { name: 'Private family trip' })).toBeInTheDocument()
  expect(createBackendTrip).toHaveBeenCalledTimes(2)
})

it('hides private data immediately while remote token revocation is still pending', async () => {
  localStorage.setItem('refreshToken', 'refresh')
  vi.mocked(restoreSession).mockResolvedValue(tokens('Kai'))
  vi.mocked(listBackendTrips).mockResolvedValue([
    { tripId: 'trip-1', userId: 'user-1', name: 'Private family trip', destination: 'Wellington', startDate: '2027-09-10', endDate: '2027-09-12' },
  ])
  vi.mocked(listBackendStops).mockResolvedValue([])
  let finishRevocation!: () => void
  vi.mocked(signOutUser).mockImplementation(() => {
    localStorage.clear()
    return new Promise<void>(resolve => { finishRevocation = resolve })
  })
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText('Private family trip')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(signOutUser).toHaveBeenCalledOnce()
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.queryByText('Private family trip')).not.toBeInTheDocument()
  expect(screen.queryByText('Welcome, Kai')).not.toBeInTheDocument()
  await act(async () => finishRevocation())
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  expect(listBackendTrips).toHaveBeenCalledOnce()
})
