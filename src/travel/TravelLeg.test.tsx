import { useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ItineraryActivity, TravelPreference } from '@/itinerary'
import { TravelLeg } from './TravelLeg'
import type { RoutesGateway, TravelEstimate } from './amazon-routes'
import { RoutesRequestError } from './amazon-routes'

const from: ItineraryActivity = { id: 1, name: 'Museum', time: '10:00', duration: '1 hr', category: 'Attraction', address: 'A', location: { lat: 35, lng: 135 } }
const to = { ...from, id: 2, name: 'Garden', location: { lat: 35.01, lng: 135.02 } }
function Harness({ gateway = null, origin = from }: { gateway?: RoutesGateway | null; origin?: ItineraryActivity }) {
  const [preference, setPreference] = useState<TravelPreference>({ mode: 'driving' })
  return <TravelLeg from={origin} to={to} gateway={gateway} preference={preference} onChange={setPreference} />
}

describe('TravelLeg', () => {
  it('automatically estimates each ground mode and displays rounded travel time', async () => {
    const user = userEvent.setup()
    const estimate = vi.fn().mockResolvedValue({ durationSeconds: 3661 })
    render(<Harness gateway={{ estimate }} />)
    expect(await screen.findByText('1 hr 2 min')).toBeInTheDocument()
    expect(estimate).toHaveBeenLastCalledWith(from.location, to.location, 'driving', expect.any(AbortSignal))
    await user.selectOptions(screen.getByRole('combobox'), 'walking')
    expect(estimate).toHaveBeenLastCalledWith(from.location, to.location, 'walking', expect.any(AbortSignal))
    await user.selectOptions(screen.getByRole('combobox'), 'transit')
    expect(estimate).toHaveBeenLastCalledWith(from.location, to.location, 'transit', expect.any(AbortSignal))
    expect(estimate).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('button', { name: /Get estimate|Refresh estimate/ })).not.toBeInTheDocument()
  })

  it('aborts a pending estimate and ignores late results after switching modes or unmounting', async () => {
    const user = userEvent.setup()
    let resolve!: (value: TravelEstimate) => void
    const estimate = vi.fn<RoutesGateway['estimate']>(() => new Promise<TravelEstimate>((done) => { resolve = done }))
    const { unmount } = render(<Harness gateway={{ estimate }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Estimating…')
    await act(async () => {})
    const signal = estimate.mock.calls[0][3] as AbortSignal
    await user.selectOptions(screen.getByRole('combobox'), 'transit')
    expect(signal.aborted).toBe(true)
    const oldResolve = resolve
    await user.selectOptions(screen.getByRole('combobox'), 'walking')
    await act(async () => oldResolve({ durationSeconds: 600 }))
    expect(screen.queryByText('10 min')).not.toBeInTheDocument()
    const nextSignal = estimate.mock.calls[2][3] as AbortSignal
    unmount()
    expect(nextSignal.aborted).toBe(true)
    await act(async () => resolve({ durationSeconds: 600 }))
  })

  it('bounds slow requests and ignores responses arriving after timeout', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (value: TravelEstimate) => void
      const estimate = vi.fn<RoutesGateway['estimate']>(() => new Promise<TravelEstimate>((done) => { resolve = done }))
      render(<Harness gateway={{ estimate }} />)
      await act(async () => {})
      await act(async () => vi.advanceTimersByTime(15000))
      expect(screen.getByRole('alert')).toHaveTextContent('The estimate timed out.')
      expect(estimate.mock.calls[0][3]?.aborted).toBe(true)
      await act(async () => resolve({ durationSeconds: 600 }))
      expect(screen.queryByText('10 min')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports failures safely and allows an explicit retry', async () => {
    const user = userEvent.setup()
    const estimate = vi.fn().mockRejectedValueOnce(new Error('secret-key')).mockRejectedValueOnce(new RoutesRequestError('No usable route was found for this transport mode.')).mockResolvedValue({ durationSeconds: 0 })
    render(<Harness gateway={{ estimate }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Travel estimates are temporarily unavailable.')
    expect(screen.queryByText(/secret-key/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No usable route')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('0 min')).toBeInTheDocument()
  })

  it('keeps manual flight/other durations usable without coordinates or a routing key', async () => {
    const user = userEvent.setup()
    const estimate = vi.fn()
    const { rerender } = render(<Harness />)
    expect(screen.getByText(/Routing is not configured/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get estimate' })).not.toBeInTheDocument()
    rerender(<Harness gateway={{ estimate }} origin={{ ...from, location: undefined }} />)
    expect(screen.getByText(/Both places need map coordinates/)).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'flying')
    const input = screen.getByRole('spinbutton', { name: /Travel time in minutes/ })
    await user.type(input, '90')
    await user.click(screen.getByRole('button', { name: 'Set time' }))
    expect(screen.getByText('Your estimate: 1 hr 30 min')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '10081')
    await user.click(screen.getByRole('button', { name: 'Set time' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter whole minutes from 1 to 10,080.')
    await user.click(screen.getByRole('button', { name: 'Clear time' }))
    expect(screen.queryByText(/Your estimate:/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'other')
    expect(within(screen.getByRole('group', { name: /Travel from Museum to Garden/ })).getByRole('spinbutton')).toHaveValue(null)
    expect(estimate).not.toHaveBeenCalled()
  })
})
