import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ActivityForm } from './ActivityEditor'
import { updateBackendStop } from './lib/backendApi'
import type { PlacesGateway } from './location/amazon-location'

vi.mock('./lib/backendApi', () => ({ updateBackendStop: vi.fn(), createBackendStop: vi.fn(), resolveBackendPlace: vi.fn() }))

const activity = { id: 1, name: 'Museum', category: 'Attraction' as const, time: '10:00', duration: '1 hr', address: 'Tokyo', location: { lat: 35, lng: 139 }, backendStopId: 'stop-1' }
function setup(gateway: PlacesGateway | null = null, saved = false) {
  const onSave = vi.fn()
  render(<ActivityForm activity={activity} backendTripId={saved ? 'trip-1' : undefined} userId="user-1" days={[]} date="2027-05-01" destination="Tokyo" isActionPending={false} gateway={gateway} onSave={onSave} onCancel={vi.fn()} onPreviewChange={vi.fn()} onSubmittingChange={vi.fn()} />)
  return onSave
}

it('saves new coordinates without changing the selected name or category', async () => {
  const user = userEvent.setup()
  const gateway: PlacesGateway = { suggest: vi.fn(), resolve: vi.fn().mockResolvedValue({ location: { lat: 48.85, lng: 2.29 } }) }
  const save = setup(gateway)
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: 'Paris' } })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Museum', category: 'Attraction', address: 'Paris', location: { lat: 48.85, lng: 2.29 } }))
})

it('keeps the old activity unchanged and preserves the draft when lookup fails', async () => {
  const user = userEvent.setup()
  const save = setup({ suggest: vi.fn(), resolve: vi.fn().mockRejectedValue(new Error('Offline')) })
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: 'Paris' } })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
  expect(screen.getByLabelText(/Address/)).toHaveValue('Paris')
})

it('does not resolve or resend an unchanged address during other edits', async () => {
  const user = userEvent.setup()
  vi.mocked(updateBackendStop).mockResolvedValue({ stopId: 'stop-1', placeName: 'Museum', category: 'Food', location: activity.location } as never)
  const save = setup(null, true)
  await user.selectOptions(screen.getByLabelText('Category'), 'Food')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(updateBackendStop).toHaveBeenLastCalledWith('trip-1', 'stop-1', 'user-1', expect.objectContaining({ address: undefined }))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ location: activity.location }))
})

it.each([undefined, { lat: 48.85, lng: 2.29 }])('uses saved backend coordinates after an address edit (%j)', async (location) => {
  const user = userEvent.setup()
  vi.mocked(updateBackendStop).mockResolvedValue({ stopId: 'stop-1', placeName: 'Museum', category: 'Attraction', location } as never)
  const save = setup(null, true)
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: location ? 'Paris' : '' } })
  await user.click(within(screen.getByRole('form')).getByRole('button', { name: 'Save changes' }))
  expect(save.mock.calls[0][0].location).toEqual(location)
})
