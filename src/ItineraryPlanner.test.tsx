import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ItineraryPlanner } from './ItineraryPlanner'
import { updateItineraryDates } from './itinerary'
import type { ItineraryProject } from './itinerary'
import type { PlacesGateway } from './location/amazon-location'

const projectFixture: ItineraryProject = {
  id: 91,
  name: 'Test journey',
  destination: 'Hamilton, New Zealand',
  startDate: '2027-05-01',
  endDate: '2027-05-02',
  collaborators: 1,
  accent: 'from-emerald-700 to-emerald-400',
  days: [
    {
      id: '2027-05-01',
      date: '2027-05-01',
      activities: [
        {
          id: 911,
          name: 'Late museum visit',
          category: 'Attraction',
          time: '15:00',
          duration: '2 hr',
          address: '1 Museum Lane',
          location: { lat: -37.787, lng: 175.281 },
        },
      ],
    },
    { id: '2027-05-02', date: '2027-05-02', activities: [] },
  ],
}

// dnd-kit's keyboard sensor decides direction by comparing real element
// rects, which jsdom always reports as zero-size/zero-position - give each
// activity card a distinct, increasing top so "move up/down" has something
// real to compare against.
function mockActivityCardRects(orderedActivityNames: string[]) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const label = this.tagName === 'ARTICLE' ? this.getAttribute('aria-label') : null
    const top = label ? orderedActivityNames.indexOf(label) * 100 : 0
    return { top, bottom: top + 80, left: 0, right: 300, width: 300, height: 80, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
}

// KeyboardSensor defers attaching its own move/drop listeners via
// setTimeout(0) (to avoid the activating keydown re-triggering itself), so
// firing the next key synchronously right after would be missed.
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

function renderPlanner(project: ItineraryProject = projectFixture, placesGateway?: PlacesGateway | null) {
  const onBack = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()

  function PlannerHarness() {
    const [currentProject, setCurrentProject] = useState(() => structuredClone(project))
    return (
      <ItineraryPlanner
        onBack={onBack}
        onChange={(projectId, update) => {
          setCurrentProject((current) => (current.id === projectId ? update(current) : current))
        }}
        onDelete={async () => {
          onDelete()
          return true
        }}
        onEdit={async (updates) => {
          onEdit(updates)
          setCurrentProject((current) => ({ ...updateItineraryDates(current, updates.startDate, updates.endDate), ...updates }))
          return true
        }}
        placesGateway={placesGateway}
        project={currentProject}
        userId="user-1"
      />
    )
  }

  render(<PlannerHarness />)
  return { onBack, onEdit, onDelete }
}

describe('ItineraryPlanner', () => {
  it('estimates only changed neighbours after insertion, removal and reordering', async () => {
    const user = userEvent.setup()
    const estimate = vi.fn().mockResolvedValue({ durationSeconds: 600 })
    const gateway = { estimate }
    const activities = ['Museum', 'Garden', 'Hotel', 'Cafe'].map((name, index) => ({
      ...projectFixture.days[0].activities[0], id: index + 1, name,
      location: { lat: -37.78 + index / 1000, lng: 175.28 },
    }))
    function view(order: number[]) {
      return <StrictMode><ItineraryPlanner project={{ ...projectFixture, days: [{ ...projectFixture.days[0], activities: order.map((index) => activities[index]) }, projectFixture.days[1]] }}
        userId="test" onBack={vi.fn()} onChange={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} locationConfig={null} routesGateway={gateway} /></StrictMode>
    }
    const { rerender } = render(view([0, 1, 2]))
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(2))
    expect(screen.getAllByRole('link', { name: 'AWS data attribution' })).toHaveLength(1)
    rerender(view([0, 1, 3, 2]))
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(4))
    expect(estimate.mock.calls.slice(2).map((call) => call.slice(0, 2))).toEqual([
      [activities[1].location, activities[3].location], [activities[3].location, activities[2].location],
    ])
    rerender(view([0, 1, 2]))
    await act(async () => {})
    expect(estimate).toHaveBeenCalledTimes(4)
    rerender(view([1, 0, 2]))
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(6))
    await user.click(screen.getByRole('button', { name: /Day 2/i }))
    await user.click(screen.getByRole('button', { name: /Day 1/i }))
    await act(async () => {})
    expect(estimate).toHaveBeenCalledTimes(6)
  })

  it('keeps travel choices per consecutive pair across days and clears changed journeys after removal', async () => {
    const user = userEvent.setup()
    renderPlanner({
      ...projectFixture,
      days: [{ ...projectFixture.days[0], activities: [
        projectFixture.days[0].activities[0],
        { ...projectFixture.days[0].activities[0], id: 912, name: 'Garden', time: '18:00' },
        { ...projectFixture.days[0].activities[0], id: 913, name: 'Hotel', time: '19:00' },
      ] }, projectFixture.days[1]],
    })
    expect(screen.getAllByRole('group', { name: /^Travel from/ })).toHaveLength(2)
    const firstLeg = screen.getByRole('group', { name: 'Travel from Late museum visit to Garden' })
    await user.selectOptions(within(firstLeg).getByRole('combobox'), 'flying')
    await user.type(within(firstLeg).getByRole('spinbutton'), '90')
    await user.click(within(firstLeg).getByRole('button', { name: 'Set time' }))
    await user.selectOptions(screen.getByLabelText('Transport from Garden to Hotel'), 'walking')
    await user.click(screen.getByRole('button', { name: /Day 2/i }))
    expect(screen.queryByRole('group', { name: /^Travel from/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Day 1/i }))
    expect(screen.getByText('Your estimate: 1 hr 30 min')).toBeInTheDocument()
    expect(screen.getByLabelText('Transport from Garden to Hotel')).toHaveValue('walking')
    await user.click(screen.getByRole('button', { name: 'Remove Garden' }))
    expect(screen.getAllByRole('group', { name: /^Travel from/ })).toHaveLength(1)
    expect(screen.getByLabelText('Transport from Late museum visit to Hotel')).toHaveValue('driving')
    expect(screen.queryByText(/Your estimate:/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Hotel' }))
    expect(screen.queryByRole('group', { name: /^Travel from/ })).not.toBeInTheDocument()
  })

  it('adds complete place details, appended after existing places regardless of time', async () => {
    const user = userEvent.setup()
    renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Add another place' }))

    const form = screen.getByRole('form', { name: 'Add place' })
    expect(within(form).getByLabelText('Start time')).toHaveValue('17:00')
    await user.type(within(form).getByLabelText('Place name'), 'Early breakfast')
    await user.selectOptions(within(form).getByLabelText('Category'), 'Food')
    await user.clear(within(form).getByLabelText('Start time'))
    await user.type(within(form).getByLabelText('Start time'), '09:00')
    await user.clear(within(form).getByLabelText('Duration'))
    await user.type(within(form).getByLabelText('Duration'), '45 min')
    await user.type(within(form).getByLabelText('Notes (optional)'), '  Bring tickets\nMeet at <east gate>  ')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    const activityNames = screen
      .getAllByRole('article')
      .map((activity) => within(activity).getByRole('heading', { level: 3 }).textContent)

    expect(activityNames).toEqual(['Late museum visit', 'Early breakfast'])
    expect(screen.getByText('Address to be confirmed')).toBeInTheDocument()
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.getByText('09:00')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Early breakfast' })).getByText('09:45')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Late museum visit' })).getByText('17:00')).toBeInTheDocument()
    expect(screen.getByText('45 min')).toBeInTheDocument()
    const notes = within(screen.getByRole('article', { name: 'Early breakfast' })).getByText(/Bring tickets/)
    expect(notes.textContent).toBe('Bring tickets\nMeet at <east gate>')
    await user.click(screen.getByRole('button', { name: /Day 2/i }))
    expect(screen.queryByText(/Bring tickets/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Day 1/i }))
    expect(screen.getByText(/Bring tickets/)).toBeInTheDocument()
    expect(screen.getByText('1 mapped stop')).toBeInTheDocument()
    expect(screen.getAllByText('Not shown on map')).toHaveLength(2)

    // Suggests a start time based on whichever activity is last in the list -
    // that's now "Early breakfast" (09:00 + 45 min), since adding no longer
    // re-sorts the day back into chronological order.
    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    expect(screen.getByLabelText('Start time')).toHaveValue('09:45')
  })

  it('chains consecutive additions and refreshes an untouched start after removal while the form is open', async () => {
    const user = userEvent.setup()
    renderPlanner()
    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    await user.type(screen.getByLabelText('Place name'), 'Dinner')
    await user.clear(screen.getByLabelText('Duration'))
    await user.type(screen.getByLabelText('Duration'), '1 hr 30 min')
    await user.click(screen.getByRole('button', { name: 'Add to day' }))

    expect(within(screen.getByRole('article', { name: 'Dinner' })).getByText('18:30')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    expect(screen.getByLabelText('Start time')).toHaveValue('18:30')
    await user.type(screen.getByLabelText('Place name'), 'Evening walk')
    await user.clear(screen.getByLabelText('Duration'))
    await user.type(screen.getByLabelText('Duration'), '45 min')
    await user.click(screen.getByRole('button', { name: 'Remove Dinner' }))
    expect(screen.getByLabelText('Start time')).toHaveValue('17:00')
    expect(screen.getByLabelText('Place name')).toHaveValue('Evening walk')
    expect(screen.getByLabelText('Duration')).toHaveValue('45 min')
    expect(screen.getByText('Ends at 17:45')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add to day' }))
    const activity = screen.getByRole('article', { name: 'Evening walk' })
    expect(within(activity).getByText('17:00')).toBeInTheDocument()
    expect(within(activity).getByText('17:45')).toBeInTheDocument()
  })

  it.each(['09:00', ''])('preserves an explicitly edited start (%j) when the previous activity is removed', async (time) => {
    const user = userEvent.setup()
    renderPlanner()
    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    await user.clear(screen.getByLabelText('Start time'))
    if (time) await user.type(screen.getByLabelText('Start time'), time)
    await user.click(screen.getByRole('button', { name: 'Remove Late museum visit' }))
    expect(screen.getByLabelText('Start time')).toHaveValue(time)
  })

  it('labels overnight end times and requires an explicit start for another same-day stop', async () => {
    const user = userEvent.setup()
    renderPlanner({
      ...projectFixture,
      days: [{
        ...projectFixture.days[0],
        activities: [{ ...projectFixture.days[0].activities[0], time: '23:30', duration: '1 hr' }],
      }],
    })
    expect(screen.getByText('00:30')).toBeInTheDocument()
    expect(screen.getByText('(next day)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    expect(screen.getByLabelText('Start time')).toHaveValue('')
    expect(screen.getByText(/previous activity ends the next day/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Late museum visit' }))
    expect(screen.getByLabelText('Start time')).toHaveValue('10:00')
    expect(screen.queryByText(/previous activity ends the next day/i)).not.toBeInTheDocument()
  })

  it('discards cancelled note drafts and omits blank notes', async () => {
    const user = userEvent.setup()
    renderPlanner()
    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    await user.type(screen.getByLabelText('Notes (optional)'), 'Cancelled draft')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('')
    await user.type(screen.getByLabelText('Place name'), 'Lunch')
    await user.type(screen.getByLabelText('Notes (optional)'), '   ')
    await user.click(screen.getByRole('button', { name: 'Add to day' }))
    expect(within(screen.getByRole('article', { name: 'Lunch' })).getByText('No notes')).toBeInTheDocument()
    expect(screen.queryByText('Cancelled draft')).not.toBeInTheDocument()
  })

  it('maps a stop using the location the backend resolved and stored, even without a live search selection', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        stopId: 'stop-1',
        placeName: 'Backend resolved cafe',
        category: 'Attraction',
        location: { lat: -37.79, lng: 175.28 },
      }),
    } as Response)

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Backend resolved cafe')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(await screen.findByRole('button', { name: 'Day 1, stop 2: Backend resolved cafe' })).toBeInTheDocument()
  })

  it('sends the typed name to the backend for its own resolution instead of forwarding the incompatible legacy search place ID', async () => {
    const user = userEvent.setup()
    const placesGateway: PlacesGateway = {
      suggest: vi.fn().mockResolvedValue([{
        id: 'esri-suggestion-id',
        placeId: 'esri-suggestion-id',
        text: 'Fushimi Inari Taisha, Kyoto, Japan',
        categories: ['Tourist Attraction'],
      }]),
      resolve: vi.fn().mockResolvedValue({
        placeId: 'esri-suggestion-id',
        name: 'Fushimi Inari Taisha',
        address: 'Fushimi Inari Taisha, 68 Fukakusa Yabunouchicho, Kyoto, Japan',
        category: 'Attraction',
        location: { lat: 34.9671, lng: 135.7727 },
        provider: 'amazon-location',
        region: 'us-east-1',
      }),
    }
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Fushimi Inari Taisha', placeId: 'v2-fushimi', category: 'Attraction', address: 'Kyoto', location: { lat: 34.9671, lng: 135.7727 } }) } as Response)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        stopId: 'stop-1',
        placeName: 'Fushimi Inari Taisha',
        category: 'Attraction',
        location: { lat: 34.9671, lng: 135.7727 },
      }),
    } as Response)

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' }, placesGateway)

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    const placeName = within(form).getByRole('combobox', { name: 'Place name' })
    await user.type(placeName, 'Fushimi')
    await user.click(await screen.findByRole('option', { name: /Fushimi Inari Taisha/i }))
    await screen.findByRole('button', { name: 'Change place' })
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    await screen.findByRole('heading', { name: 'Fushimi Inari Taisha' })
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    const requestBody = JSON.parse(requestInit?.body as string) as Record<string, unknown>
    expect(requestBody).not.toHaveProperty('placeId')
    expect(requestBody.query).toBe('Fushimi Inari Taisha')
    expect(JSON.parse(vi.mocked(globalThis.fetch).mock.calls[1][1]?.body as string).placeId).toBe('v2-fushimi')
  })

  it('keeps the form open with an error, and does not add a card, when the backend responds with an error status', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'Invalid stop input' }),
    } as Response)

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Uncertain cafe')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this place. Please try again.')
    expect(screen.queryByRole('heading', { name: 'Uncertain cafe' })).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Add place' })).toBeInTheDocument()
    expect(within(form).getByLabelText('Place name')).toHaveValue('Uncertain cafe')
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
  })

  it('lets the user retry adding a place after a failed submission succeeds the second time', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ stopId: 'stop-1', placeName: 'Persistent cafe', category: 'Attraction' }),
      } as Response)

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Persistent cafe')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this place. Please try again.')

    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(await screen.findByRole('heading', { name: 'Persistent cafe' })).toBeInTheDocument()
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2)
  })

  it('sends a compound duration like "1 hr 30 min" to the backend as 90 minutes, not just the first component', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', placeName: 'Long lunch', category: 'Attraction' }),
    } as Response)

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Long lunch')
    await user.clear(screen.getByLabelText('Duration'))
    await user.type(screen.getByLabelText('Duration'), '1 hr 30 min')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    await screen.findByRole('heading', { name: 'Long lunch' })
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    const requestBody = JSON.parse(requestInit?.body as string) as Record<string, unknown>
    expect(requestBody.visitDurationMinutes).toBe(90)
  })

  it('sends the chosen category to the backend so a manual pick like Food is not discarded', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', placeName: 'The Sushi House', category: 'Other' }),
    } as Response)

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'The Sushi House')
    await user.selectOptions(within(form).getByLabelText('Category'), 'Food')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    await screen.findByRole('heading', { name: 'The Sushi House' })
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    const requestBody = JSON.parse(requestInit?.body as string) as Record<string, unknown>
    expect(requestBody.category).toBe('Food')
  })

  it('disables the submit button while a stop is being created, preventing duplicate submissions', async () => {
    const user = userEvent.setup()
    let resolveFetch: (value: Response) => void = () => {}
    vi.mocked(globalThis.fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Slow cafe')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(within(form).getByRole('button', { name: 'Adding…' })).toBeDisabled()
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', placeName: 'Slow cafe', category: 'Attraction' }),
    } as Response)

    expect(await screen.findByRole('heading', { name: 'Slow cafe' })).toBeInTheDocument()
  })

  it('disables both cancel controls while a stop is being submitted, so a cancel can never race a save that then fails to clean up', async () => {
    const user = userEvent.setup()
    let resolveFetch: (value: Response) => void = () => {}
    vi.mocked(globalThis.fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Abandoned cafe')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close add place form' })).toBeDisabled()
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', placeName: 'Abandoned cafe', category: 'Attraction' }),
    } as Response)

    expect(await screen.findByRole('heading', { name: 'Abandoned cafe' })).toBeInTheDocument()
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
  })

  it('disables day switching and leaving the trip while a stop is being submitted, so the in-flight save cannot be silently abandoned by navigating away instead of cancelling', async () => {
    const user = userEvent.setup()
    let resolveFetch: (value: Response) => void = () => {}
    vi.mocked(globalThis.fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    renderPlanner({ ...projectFixture, backendTripId: 'trip-1' })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Abandoned cafe')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(screen.getByRole('button', { name: /Day 2/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit trip details' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to itineraries' })).toBeDisabled()

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', placeName: 'Abandoned cafe', category: 'Attraction' }),
    } as Response)

    await screen.findByRole('heading', { name: 'Abandoned cafe' })
    expect(screen.getByRole('button', { name: /Day 2/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to itineraries' })).not.toBeDisabled()
  })

  it('rejects whitespace-only place details', async () => {
    const user = userEvent.setup()
    renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Add another place' }))

    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), '   ')
    await user.clear(within(form).getByLabelText('Duration'))
    await user.type(within(form).getByLabelText('Duration'), '   ')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(screen.getByText('Enter a place name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a duration.')).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(within(form).getByLabelText('Place name')).toHaveFocus()
    expect(screen.getByRole('form', { name: 'Add place' })).toBeInTheDocument()

    await user.type(within(form).getByLabelText('Place name'), 'Museum')
    await user.clear(within(form).getByLabelText('Duration'))
    await user.type(within(form).getByLabelText('Duration'), 'later')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))
    expect(within(form).getByLabelText('Duration')).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a duration from 1 min to 24 hr')
  })

  it('restores focus to the add trigger after cancelling', async () => {
    const user = userEvent.setup()
    renderPlanner()
    const trigger = screen.getByRole('button', { name: 'Add a place' })

    await user.click(trigger)
    await user.click(within(screen.getByRole('form', { name: 'Add place' })).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('form', { name: 'Add place' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('removes the last place and updates the empty, status, and map states', async () => {
    const user = userEvent.setup()
    renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Remove Late museum visit' }))

    expect(screen.getByText('Nothing planned for this day yet')).toBeInTheDocument()
    expect(screen.getByText('No mapped places for this day')).toBeInTheDocument()
    expect(screen.getByText('Ready to plan')).toBeInTheDocument()
    expect(screen.getAllByText('0 places')).toHaveLength(3)
    expect(screen.queryByRole('heading', { name: 'Late museum visit' })).not.toBeInTheDocument()
  })

  it('keeps the place and shows an error when the backend delete fails', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] },
        projectFixture.days[1],
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Remove Late museum visit' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete this place. Please try again.')
    expect(screen.getByRole('heading', { name: 'Late museum visit' })).toBeInTheDocument()
  })

  it('ignores a second remove click while the first delete is still in flight', async () => {
    const user = userEvent.setup()
    let resolveFetch!: (value: Response) => void
    vi.mocked(globalThis.fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveFetch = resolve }),
    )

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] },
        projectFixture.days[1],
      ],
    })

    const removeButton = screen.getByRole('button', { name: 'Remove Late museum visit' })
    await user.click(removeButton)

    expect(removeButton).toBeDisabled()
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)

    resolveFetch({ ok: true, json: () => Promise.resolve({ message: 'Deleted' }) } as Response)

    expect(await screen.findByText('Nothing planned for this day yet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Late museum visit' })).not.toBeInTheDocument()
  })

  it('edits an activity\'s time through the shared form and persists it to the backend', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', time: '18:00' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] },
        projectFixture.days[1],
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
    const timeInput = screen.getByLabelText('Start time')
    await user.clear(timeInput)
    await user.type(timeInput, '18:00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('18:00')).toBeInTheDocument()
    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1/stops/stop-1?userId=user-1')
    expect(requestInit?.method).toBe('PATCH')
    expect(JSON.parse(requestInit?.body as string)).toMatchObject({ time: '18:00' })
  })

  it('saves a cleared start time instead of silently discarding it', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', time: '' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] },
        projectFixture.days[1],
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
    const timeInput = screen.getByLabelText('Start time')
    await user.clear(timeInput)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Time not set')).toBeInTheDocument()
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(JSON.parse(requestInit?.body as string)).toMatchObject({ time: '' })
  })

  it('keeps the old time and shows an error when the backend update fails', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] },
        projectFixture.days[1],
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
    const timeInput = screen.getByLabelText('Start time')
    await user.clear(timeInput)
    await user.type(timeInput, '18:00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this place. Please try again.')
    expect(screen.getByLabelText('Start time')).toHaveValue('18:00')
    expect(screen.getByText('15:00')).toBeInTheDocument()
  })

  it('adds notes to an activity that has none, and persists them to the backend', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1', notes: 'Bring the tickets.' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] },
        projectFixture.days[1],
      ],
    })

    const card = screen.getByRole('article', { name: 'Late museum visit' })
    await user.click(within(card).getByRole('button', { name: 'Edit Late museum visit' }))
    const notesInput = screen.getByLabelText('Notes (optional)')
    await user.type(notesInput, 'Bring the tickets.')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await within(card).findByText('Bring the tickets.')).toBeInTheDocument()
    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1/stops/stop-1?userId=user-1')
    expect(requestInit?.method).toBe('PATCH')
    expect(JSON.parse(requestInit?.body as string)).toMatchObject({ notes: 'Bring the tickets.' })
  })

  it('clears existing notes to blank when edited to blank', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-1' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        {
          ...projectFixture.days[0],
          activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1', notes: 'Old note' }],
        },
        projectFixture.days[1],
      ],
    })

    const card = screen.getByRole('article', { name: 'Late museum visit' })
    await user.click(within(card).getByRole('button', { name: 'Edit Late museum visit' }))
    const notesInput = screen.getByLabelText('Notes (optional)')
    await user.clear(notesInput)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await within(card).findByText('No notes')).toBeInTheDocument()
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(JSON.parse(requestInit?.body as string)).toMatchObject({ notes: '' })
  })

  it('keeps the old notes and shows an error when the backend update fails', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] },
        projectFixture.days[1],
      ],
    })

    const card = screen.getByRole('article', { name: 'Late museum visit' })
    await user.click(within(card).getByRole('button', { name: 'Edit Late museum visit' }))
    await user.type(screen.getByLabelText('Notes (optional)'), 'Bring the tickets.')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this place. Please try again.')
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Bring the tickets.')
  })

  it('keeps the shared draft and disables competing actions while saving', async () => {
    const user = userEvent.setup()
    let finish!: (response: Response) => void
    vi.mocked(globalThis.fetch).mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve }))
    renderPlanner({ ...projectFixture, backendTripId: 'trip-1', days: [
      { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' }] }, projectFixture.days[1],
    ] })
    await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
    await user.type(screen.getByLabelText('Notes (optional)'), 'Bring a jacket.')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add a place' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Day 1, stop 1: Late museum visit' }))
    expect(screen.getByRole('form', { name: 'Edit place' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Late museum visit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit Late museum visit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to itineraries' })).toBeDisabled()
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Bring a jacket.')
    expect(screen.getByLabelText('Notes (optional)')).toBeDisabled()
    await act(async () => finish({ ok: false, status: 500 } as Response))
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Bring a jacket.')
  })

  it('reorders stops via keyboard drag-and-drop and saves the new neighbours to the backend', async () => {
    const rectSpy = mockActivityCardRects(['Late museum visit', 'Evening garden walk'])
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stopId: 'stop-2', order: 500 }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        {
          ...projectFixture.days[0],
          activities: [
            { ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' },
            {
              id: 912,
              name: 'Evening garden walk',
              category: 'Other',
              time: '18:00',
              duration: '1 hr',
              address: '2 Garden Lane',
              location: { lat: -37.79, lng: 175.29 },
              backendStopId: 'stop-2',
            },
          ],
        },
        projectFixture.days[1],
      ],
    })

    const handle = screen.getByRole('button', { name: 'Reorder Evening garden walk' })
    handle.focus()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()
    fireEvent.keyDown(handle, { code: 'ArrowUp' })
    await tick()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()

    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1))
    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/trips/trip-1/stops/stop-2?userId=user-1')
    expect(requestInit?.method).toBe('PATCH')
    expect(JSON.parse(requestInit?.body as string)).toEqual({ nextStopId: 'stop-1' })

    const articles = screen.getAllByRole('article')
    expect(articles.map((article) => article.getAttribute('aria-label'))).toEqual([
      'Evening garden walk',
      'Late museum visit',
    ])
    rectSpy.mockRestore()
  })

  it('rolls back the order and shows an error when saving a reorder fails', async () => {
    const rectSpy = mockActivityCardRects(['Late museum visit', 'Evening garden walk'])
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        {
          ...projectFixture.days[0],
          activities: [
            { ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' },
            {
              id: 912,
              name: 'Evening garden walk',
              category: 'Other',
              time: '18:00',
              duration: '1 hr',
              address: '2 Garden Lane',
              location: { lat: -37.79, lng: 175.29 },
              backendStopId: 'stop-2',
            },
          ],
        },
        projectFixture.days[1],
      ],
    })

    const handle = screen.getByRole('button', { name: 'Reorder Evening garden walk' })
    handle.focus()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()
    fireEvent.keyDown(handle, { code: 'ArrowUp' })
    await tick()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the new order. Please try again.')
    const articles = screen.getAllByRole('article')
    expect(articles.map((article) => article.getAttribute('aria-label'))).toEqual([
      'Late museum visit',
      'Evening garden walk',
    ])
    rectSpy.mockRestore()
  })

  it('restores a travel preference dropped by an optimistic reorder when the save fails', async () => {
    const rectSpy = mockActivityCardRects(['Late museum visit', 'Evening garden walk', 'Sunset dinner'])
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    } as Response)

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        {
          ...projectFixture.days[0],
          activities: [
            { ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' },
            {
              id: 912, name: 'Evening garden walk', category: 'Other', time: '18:00', duration: '1 hr',
              address: '2 Garden Lane', location: { lat: -37.79, lng: 175.29 }, backendStopId: 'stop-2',
            },
            {
              id: 913, name: 'Sunset dinner', category: 'Food', time: '20:00', duration: '1 hr',
              address: '3 Harbour Road', location: { lat: -37.8, lng: 175.3 }, backendStopId: 'stop-3',
            },
          ],
          // A preference between the first two stops - dragging the third stop
          // between them makes it, not the second stop, adjacent to the first.
          travel: { '911:912': { mode: 'flying', minutes: 90 } },
        },
        projectFixture.days[1],
      ],
    })

    expect(screen.getByLabelText('Transport from Late museum visit to Evening garden walk')).toHaveValue('flying')

    // Drag "Sunset dinner" (last) up one position, between the first two stops.
    const handle = screen.getByRole('button', { name: 'Reorder Sunset dinner' })
    handle.focus()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()
    fireEvent.keyDown(handle, { code: 'ArrowUp' })
    await tick()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the new order. Please try again.')
    const articles = screen.getAllByRole('article')
    expect(articles.map((article) => article.getAttribute('aria-label'))).toEqual([
      'Late museum visit',
      'Evening garden walk',
      'Sunset dinner',
    ])
    expect(screen.getByLabelText('Transport from Late museum visit to Evening garden walk')).toHaveValue('flying')
    rectSpy.mockRestore()
  })

  it('keeps a travel edit made to an unrelated leg while a reorder is still in flight, instead of reverting it on rollback', async () => {
    const user = userEvent.setup()
    const rectSpy = mockActivityCardRects(['Late museum visit', 'Evening garden walk', 'Sunset dinner', 'Sunrise walk'])
    let resolveFetch!: (value: Response) => void
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve }),
    )

    renderPlanner({
      ...projectFixture,
      backendTripId: 'trip-1',
      days: [
        {
          ...projectFixture.days[0],
          activities: [
            { ...projectFixture.days[0].activities[0], backendStopId: 'stop-1' },
            {
              id: 912, name: 'Evening garden walk', category: 'Other', time: '18:00', duration: '1 hr',
              address: '2 Garden Lane', location: { lat: -37.79, lng: 175.29 }, backendStopId: 'stop-2',
            },
            {
              id: 913, name: 'Sunset dinner', category: 'Food', time: '20:00', duration: '1 hr',
              address: '3 Harbour Road', location: { lat: -37.8, lng: 175.3 }, backendStopId: 'stop-3',
            },
            {
              id: 914, name: 'Sunrise walk', category: 'Other', time: '06:00', duration: '1 hr',
              address: '4 Beach Road', location: { lat: -37.7, lng: 175.2 }, backendStopId: 'stop-4',
            },
          ],
          // "911:912" is dropped by dragging Sunrise walk between them; "912:913"
          // stays adjacent (Garden -> Dinner) throughout the whole drag, both
          // during the pending request and after a rollback to this order.
          travel: { '911:912': { mode: 'flying', minutes: 90 } },
        },
        projectFixture.days[1],
      ],
    })

    // Drag "Sunrise walk" (last) up two positions, between the first two stops.
    const handle = screen.getByRole('button', { name: 'Reorder Sunrise walk' })
    handle.focus()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()
    fireEvent.keyDown(handle, { code: 'ArrowUp' })
    await tick()
    fireEvent.keyDown(handle, { code: 'ArrowUp' })
    await tick()
    fireEvent.keyDown(handle, { code: 'Space' })
    await tick()

    // The request is still pending - change an unrelated, still-adjacent leg's
    // transport mode while waiting, same as a user legitimately could.
    const unrelatedLegSelect = screen.getByLabelText('Transport from Evening garden walk to Sunset dinner')
    await user.selectOptions(unrelatedLegSelect, 'walking')
    expect(unrelatedLegSelect).toHaveValue('walking')

    await act(async () => {
      resolveFetch({ ok: false, status: 500, json: () => Promise.resolve({ message: 'Internal server error' }) } as Response)
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the new order. Please try again.')
    const articles = screen.getAllByRole('article')
    expect(articles.map((article) => article.getAttribute('aria-label'))).toEqual([
      'Late museum visit',
      'Evening garden walk',
      'Sunset dinner',
      'Sunrise walk',
    ])
    // The originally-dropped preference is restored...
    expect(screen.getByLabelText('Transport from Late museum visit to Evening garden walk')).toHaveValue('flying')
    // ...and the edit made during the pending window is not reverted.
    expect(screen.getByLabelText('Transport from Evening garden walk to Sunset dinner')).toHaveValue('walking')
    rectSpy.mockRestore()
  })

  it('does not reorder activities when a time is edited to be earlier than an activity before it', async () => {
    const user = userEvent.setup()
    renderPlanner({
      ...projectFixture,
      days: [
        {
          ...projectFixture.days[0],
          activities: [
            projectFixture.days[0].activities[0],
            {
              id: 912,
              name: 'Evening garden walk',
              category: 'Other',
              time: '18:00',
              duration: '1 hr',
              address: '2 Garden Lane',
              location: { lat: -37.79, lng: 175.29 },
            },
          ],
        },
        projectFixture.days[1],
      ],
    })

    const secondCard = screen.getByRole('article', { name: 'Evening garden walk' })
    await user.click(within(secondCard).getByRole('button', { name: 'Edit Evening garden walk' }))
    const timeInput = screen.getByLabelText('Start time')
    await user.clear(timeInput)
    await user.type(timeInput, '08:00')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const activityNames = screen
      .getAllByRole('article')
      .map((article) => article.getAttribute('aria-label'))
    expect(activityNames).toEqual(['Late museum visit', 'Evening garden walk'])
    expect(within(secondCard).getByText('08:00')).toBeInTheDocument()

    const firstCard = screen.getByRole('article', { name: 'Late museum visit' })
    expect(within(secondCard).getByText('Scheduled earlier than the stop before it')).toBeInTheDocument()
    expect(within(firstCard).queryByText('Scheduled earlier than the stop before it')).not.toBeInTheDocument()
  })

  it('appends a newly added place after existing ones, even when its time is earlier', async () => {
    const user = userEvent.setup()
    renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Sunrise walk')
    await user.clear(within(form).getByLabelText('Start time'))
    await user.type(within(form).getByLabelText('Start time'), '06:00')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    const activityNames = screen
      .getAllByRole('article')
      .map((article) => article.getAttribute('aria-label'))
    expect(activityNames).toEqual(['Late museum visit', 'Sunrise walk'])
    expect(within(screen.getByRole('article', { name: 'Sunrise walk' })).getByText('Scheduled earlier than the stop before it')).toBeInTheDocument()
  })

  it('does not show the out-of-order banner when a day\'s stops are already in ascending time order', async () => {
    renderPlanner({
      ...projectFixture,
      days: [
        {
          ...projectFixture.days[0],
          activities: [
            projectFixture.days[0].activities[0],
            {
              id: 912,
              name: 'Evening garden walk',
              category: 'Other',
              time: '18:00',
              duration: '1 hr',
              address: '2 Garden Lane',
              location: { lat: -37.79, lng: 175.29 },
            },
          ],
        },
        projectFixture.days[1],
      ],
    })

    expect(screen.queryByText('Scheduled earlier than the stop before it')).not.toBeInTheDocument()
  })

  it('shows a placeholder for an activity with no time set', async () => {
    renderPlanner({
      ...projectFixture,
      days: [
        { ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], time: '' }] },
        projectFixture.days[1],
      ],
    })

    expect(screen.getByText('Time not set')).toBeInTheDocument()
  })

  it('removes only the selected place and reindexes the remaining route', async () => {
    const user = userEvent.setup()
    renderPlanner({
      ...projectFixture,
      days: [
        {
          ...projectFixture.days[0],
          activities: [
            ...projectFixture.days[0].activities,
            {
              id: 912,
              name: 'Evening garden walk',
              category: 'Other',
              time: '18:00',
              duration: '1 hr',
              address: '2 Garden Lane',
              location: { lat: -37.79, lng: 175.29 },
            },
          ],
        },
        projectFixture.days[1],
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Remove Late museum visit' }))

    expect(screen.queryByRole('heading', { name: 'Late museum visit' })).not.toBeInTheDocument()
    const remainingActivity = screen.getByRole('article')
    expect(within(remainingActivity).getByRole('heading', { name: 'Evening garden walk' })).toBeInTheDocument()
    expect(within(remainingActivity).getByText('1')).toBeInTheDocument()
    expect(screen.getByText('1 mapped stop')).toBeInTheDocument()
    expect(screen.getByText('Planning')).toBeInTheDocument()
  })

  it('keeps places isolated to their selected day and preserves them when switching', async () => {
    const user = userEvent.setup()
    renderPlanner()

    await user.click(screen.getByRole('button', { name: /Day 2/i }))
    await user.click(screen.getByRole('button', { name: 'Add the first place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    expect(within(form).getByLabelText('Start time')).toHaveValue('10:00')
    await user.type(within(form).getByLabelText('Place name'), 'City viewpoint')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(screen.getByRole('heading', { name: 'City viewpoint' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Late museum visit' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Day 1/i }))
    expect(screen.getByRole('heading', { name: 'Late museum visit' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'City viewpoint' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Day 2/i }))
    expect(screen.getByRole('heading', { name: 'City viewpoint' })).toBeInTheDocument()
  })

  it('defaults to this-day map scope and includes mapped places from every day in entire-trip scope', async () => {
    const user = userEvent.setup()
    renderPlanner({
      ...projectFixture,
      days: [
        projectFixture.days[0],
        {
          ...projectFixture.days[1],
          activities: [
            {
              id: 921,
              name: 'Second-day gardens',
              category: 'Attraction',
              time: '10:00',
              duration: '1 hr',
              address: 'Garden Place',
              location: { lat: -37.78, lng: 175.27 },
            },
          ],
        },
      ],
    })

    const thisDay = screen.getByRole('button', { name: 'This day' })
    const entireTrip = screen.getByRole('button', { name: 'Entire trip' })
    expect(thisDay).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Day 1, stop 1: Late museum visit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day 2, stop 1: Second-day gardens' })).not.toBeInTheDocument()

    await user.click(entireTrip)

    expect(entireTrip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Day 2, stop 1: Second-day gardens' })).toBeInTheDocument()
    const legend = screen.getByLabelText('Map legend')
    expect(within(legend).getByText('Day 1')).toBeInTheDocument()
    expect(within(legend).getByText('Day 2')).toBeInTheDocument()
  })

  it('moves to and focuses the matching activity when a cross-day marker is activated', async () => {
    const user = userEvent.setup()
    renderPlanner({
      ...projectFixture,
      days: [
        projectFixture.days[0],
        {
          ...projectFixture.days[1],
          activities: [
            {
              id: 922,
              name: 'Riverside walk',
              category: 'Other',
              time: '11:00',
              duration: '1 hr',
              address: 'River Road',
              location: { lat: -37.79, lng: 175.3 },
            },
          ],
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Entire trip' }))
    await user.click(screen.getByRole('button', { name: 'Day 2, stop 1: Riverside walk' }))

    const card = screen.getByRole('article', { name: 'Riverside walk' })
    expect(screen.getByRole('heading', { name: 'Riverside walk' })).toBeInTheDocument()
    expect(card).toHaveFocus()
    expect(card).toHaveAttribute('data-selected', 'true')
    expect(screen.getByRole('button', { name: 'Entire trip' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps manual activities in the itinerary without assigning a fake marker', async () => {
    const user = userEvent.setup()
    renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    await user.type(within(form).getByLabelText('Place name'), 'Unmapped cafe')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(screen.getByRole('heading', { name: 'Unmapped cafe' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day 1, stop 1: Unmapped cafe' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day 1, stop 2: Unmapped cafe' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Not shown on map')).toHaveLength(2)
  })

  it('fills the form from place search, previews the flag, and adds a permanent mapped stop', async () => {
    const user = userEvent.setup()
    const placesGateway: PlacesGateway = {
      suggest: vi.fn().mockResolvedValue([
        {
          id: 'fushimi-id',
          placeId: 'fushimi-id',
          text: 'Fushimi Inari Taisha, Kyoto, Japan',
          categories: ['Tourist Attraction'],
        },
      ]),
      resolve: vi.fn().mockResolvedValue({
        placeId: 'fushimi-id',
        name: 'Fushimi Inari Taisha',
        address: 'Fushimi Inari Taisha, 68 Fukakusa Yabunouchicho, Kyoto, Japan',
        category: 'Attraction',
        location: { lat: 34.9671, lng: 135.7727 },
        provider: 'amazon-location',
        region: 'us-east-1',
      }),
    }
    renderPlanner(projectFixture, placesGateway)

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    const placeName = within(form).getByRole('combobox', { name: 'Place name' })
    await user.type(placeName, 'Fushimi')
    await user.click(await screen.findByRole('option', { name: /Fushimi Inari Taisha/i }))

    expect(within(form).getByText('Fushimi Inari Taisha')).toBeInTheDocument()
    expect(within(form).getByLabelText(/Address/)).toHaveValue(
      'Fushimi Inari Taisha, 68 Fukakusa Yabunouchicho, Kyoto, Japan',
    )
    expect(within(form).getByLabelText('Category')).toHaveValue('Attraction')
    expect(screen.getByRole('img', { name: 'Preview location: Fushimi Inari Taisha' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a place' }))
    expect(screen.getByRole('img', { name: 'Preview location: Fushimi Inari Taisha' })).toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(screen.queryByRole('img', { name: 'Preview location: Fushimi Inari Taisha' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Fushimi Inari Taisha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day 1, stop 2: Fushimi Inari Taisha' })).toBeInTheDocument()
    expect(screen.getByText('2 mapped stops')).toBeInTheDocument()
  })

  it('clears provider-derived address and marker data when changing the selected place', async () => {
    const user = userEvent.setup()
    const placesGateway: PlacesGateway = {
      suggest: vi.fn().mockResolvedValue([{
        id: 'fushimi-id',
        placeId: 'fushimi-id',
        text: 'Fushimi Inari Taisha, Kyoto, Japan',
        categories: ['Tourist Attraction'],
      }]),
      resolve: vi.fn().mockResolvedValue({
        placeId: 'fushimi-id',
        name: 'Fushimi Inari Taisha',
        address: '68 Fukakusa Yabunouchicho, Kyoto, Japan',
        category: 'Attraction',
        location: { lat: 34.9671, lng: 135.7727 },
        provider: 'amazon-location',
        region: 'us-east-1',
      }),
    }
    renderPlanner(projectFixture, placesGateway)

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    const placeName = within(form).getByRole('combobox', { name: 'Place name' })
    await user.type(placeName, 'Fushimi')
    await user.click(await screen.findByRole('option', { name: /Fushimi Inari Taisha/i }))
    expect(within(form).getByLabelText(/Address/)).toHaveValue('68 Fukakusa Yabunouchicho, Kyoto, Japan')

    await user.click(within(form).getByRole('button', { name: 'Change place' }))
    await user.type(within(form).getByRole('combobox', { name: 'Place name' }), 'Manual replacement')

    expect(within(form).getByLabelText(/Address/)).toHaveValue('')
    expect(screen.queryByRole('img', { name: /Preview location/i })).not.toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))
    const card = screen.getByRole('article', { name: 'Manual replacement' })
    expect(within(card).getByText('Address to be confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day 1, stop 1: Manual replacement' })).not.toBeInTheDocument()
  })

  it('exposes live-search name validation through the combobox accessibility state', async () => {
    const user = userEvent.setup()
    renderPlanner(projectFixture, {
      suggest: vi.fn().mockResolvedValue([]),
      resolve: vi.fn(),
    })

    await user.click(screen.getByRole('button', { name: 'Add another place' }))
    const form = screen.getByRole('form', { name: 'Add place' })
    const placeName = within(form).getByRole('combobox', { name: 'Place name' })
    await user.type(placeName, '   ')
    await user.click(within(form).getByRole('button', { name: 'Add to day' }))

    expect(placeName).toHaveAttribute('aria-invalid', 'true')
    expect(placeName.getAttribute('aria-describedby')).toContain('place-name-error')
    expect(placeName).toHaveFocus()
  })

  it('renders a recoverable state when a project has no itinerary days', async () => {
    const user = userEvent.setup()
    const { onBack } = renderPlanner({ ...projectFixture, days: [] })

    expect(screen.getByRole('heading', { name: 'This trip has no days yet' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to itineraries' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('navigates days with buttons and disables the ends', async () => {
    const user = userEvent.setup()
    renderPlanner()
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByRole('heading', { name: 'Sunday, 2 May' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.getByRole('heading', { name: 'Saturday, 1 May' })).toBeInTheDocument()
  })

  it('shortens empty trailing days, falls back from a removed selected day and cancels date drafts', async () => {
    const user = userEvent.setup()
    renderPlanner()
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-05-01' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('heading', { name: 'Saturday, 1 May' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-05-05' } })
    await user.click(within(screen.getByRole('form', { name: 'Edit trip' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: /Day 2/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-05-02' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('heading', { name: 'Saturday, 1 May' })).toBeInTheDocument()
  })

  it('extends trip dates while preserving existing activities', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderPlanner()
    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-05-03' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2027-05-01', endDate: '2027-05-03' }))
    expect(screen.getByRole('heading', { name: 'Late museum visit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Day 3/ })).toBeInTheDocument()
  })

  it('rejects invalid ranges and refuses to remove a day with places', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderPlanner()
    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-04-30' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/1 to 60 days/)
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-05-02' } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-05-02' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Remove the places/)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('edits the trip name and destination', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    const form = screen.getByRole('form', { name: 'Edit trip' })
    await user.clear(within(form).getByLabelText('Trip name'))
    await user.type(within(form).getByLabelText('Trip name'), 'Renamed trip')
    await user.clear(within(form).getByLabelText('Main destination'))
    await user.type(within(form).getByLabelText('Main destination'), 'New destination')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed trip', destination: 'New destination' }))
    expect(screen.getByRole('heading', { name: 'Renamed trip', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Edit trip' })).not.toBeInTheDocument()
  })

  it('rejects a blank trip name when editing', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    const form = screen.getByRole('form', { name: 'Edit trip' })
    await user.clear(within(form).getByLabelText('Trip name'))
    await user.type(within(form).getByLabelText('Trip name'), '   ')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(screen.getByText('Enter a trip name.')).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('keeps the edit form open and shows an error when the backend update fails', async () => {
    const user = userEvent.setup()
    render(
      <ItineraryPlanner
        onBack={vi.fn()}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onEdit={async () => false}
        project={projectFixture}
        userId="user-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit trip details' }))
    const form = screen.getByRole('form', { name: 'Edit trip' })
    await user.clear(within(form).getByLabelText('Trip name'))
    await user.type(within(form).getByLabelText('Trip name'), 'Renamed trip')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the trip changes. Please try again.')
    expect(screen.queryByRole('button', { name: /Day 3/ })).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Edit trip' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Test journey', level: 1 })).toBeInTheDocument()
  })

  it('stays on the trip and shows an error when the backend delete fails', async () => {
    const user = userEvent.setup()
    render(
      <ItineraryPlanner
        onBack={vi.fn()}
        onChange={vi.fn()}
        onDelete={async () => false}
        onEdit={vi.fn()}
        project={projectFixture}
        userId="user-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete trip' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete the trip. Please try again.')
    expect(screen.queryByText(/Delete this trip and all its places/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Test journey', level: 1 })).toBeInTheDocument()
  })

  it('asks for confirmation before deleting the trip', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderPlanner()

    await user.click(screen.getByRole('button', { name: 'Delete trip' }))
    expect(onDelete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Delete this trip and all its places/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete trip' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

it('edits an activity through one prefilled form and cancels without changing it', async () => {
  const user = userEvent.setup()
  renderPlanner()
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  const form = screen.getByRole('form', { name: 'Edit place' })
  expect(within(form).getByLabelText('Category')).toHaveValue('Attraction')
  expect(within(form).getByLabelText('Category')).toHaveFocus()
  expect(within(form).getByLabelText('Duration')).toHaveValue('2 hr')
  await user.selectOptions(within(form).getByLabelText('Category'), 'Food')
  await user.click(within(form).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('form', { name: 'Edit place' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('article', { name: 'Late museum visit' })).getByText('Attraction')).toBeInTheDocument()
})

it('saves category, duration, address, time and notes together in the shared activity form', async () => {
  const user = userEvent.setup()
  renderPlanner()
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  const form = screen.getByRole('form', { name: 'Edit place' })
  await user.selectOptions(within(form).getByLabelText('Category'), 'Other')
  await user.clear(within(form).getByLabelText('Duration'))
  await user.type(within(form).getByLabelText('Duration'), '45 min')
  await user.clear(within(form).getByLabelText(/Address/))
  await user.type(within(form).getByLabelText(/Address/), 'East entrance')
  await user.type(within(form).getByLabelText(/Notes/), 'Bring tickets')
  fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '09:00' } })
  await user.click(within(form).getByRole('button', { name: 'Save changes' }))
  const card = screen.getByRole('article', { name: 'Late museum visit' })
  for (const text of ['Other', '45 min', 'East entrance', 'Bring tickets', '09:00']) expect(within(card).getByText(text)).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Edit place' })).not.toBeInTheDocument()
})

it('does not overwrite a category changed while selected-place details are loading', async () => {
  const user = userEvent.setup()
  let finish!: (value: Awaited<ReturnType<PlacesGateway['resolve']>>) => void
  const gateway: PlacesGateway = {
    suggest: vi.fn().mockResolvedValue([{ id: 'tower', text: 'Tokyo Skytree', categories: [] }]),
    resolve: vi.fn(() => new Promise<Awaited<ReturnType<PlacesGateway['resolve']>>>((resolve) => { finish = resolve })),
  }
  renderPlanner(projectFixture, gateway)
  await user.click(screen.getByRole('button', { name: 'Add another place' }))
  await user.type(screen.getByRole('combobox', { name: 'Place name' }), 'Tokyo')
  await user.click(await screen.findByRole('option', { name: /Tokyo Skytree/ }))
  expect(screen.getByRole('button', { name: 'Add to day' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('Category'), 'Stay')
  await act(async () => finish({ name: 'Tokyo Skytree', address: 'Tokyo', category: 'Food', provider: 'amazon-location', region: 'us-east-1', location: { lat: 35, lng: 139 } }))
  expect(screen.getByLabelText('Category')).toHaveValue('Stay')
  await user.click(screen.getByRole('button', { name: 'Add to day' }))
  expect(within(screen.getByRole('article', { name: 'Tokyo Skytree' })).getByText('Stay')).toBeInTheDocument()
})

it('replaces a place without retaining the old coordinates when the new result has none', async () => {
  const user = userEvent.setup()
  const gateway: PlacesGateway = { suggest: vi.fn().mockResolvedValue([{ id: 'cairo', text: 'Cairo Museum', categories: [] }]), resolve: vi.fn().mockResolvedValue({ name: 'Cairo Museum', address: 'Cairo, Egypt', category: 'Attraction', provider: 'amazon-location', region: 'us-east-1' }) }
  renderPlanner(projectFixture, gateway)
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  await user.click(screen.getByRole('button', { name: 'Change place' }))
  await user.type(screen.getByRole('combobox', { name: 'Place name' }), 'Cairo')
  await user.click(await screen.findByRole('option', { name: /Cairo Museum/ }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const card = screen.getByRole('article', { name: 'Cairo Museum' })
  expect(within(card).getByText('Not shown on map')).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'Late museum visit' })).not.toBeInTheDocument()
})

it('does not show an add-next-activity hint when editing an overnight activity itself', async () => {
  const user = userEvent.setup()
  renderPlanner({ ...projectFixture, days: [{ ...projectFixture.days[0], activities: [{ ...projectFixture.days[0].activities[0], time: '23:30' }] }, projectFixture.days[1]] })
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  expect(screen.queryByText(/previous activity ends the next day/i)).not.toBeInTheDocument()
})

it('requires a successful replacement selection and retains the saved activity after lookup failure', async () => {
  const user = userEvent.setup()
  const gateway: PlacesGateway = { suggest: vi.fn().mockResolvedValue([{ id: 'seoul', text: 'Seoul Station', categories: [] }]), resolve: vi.fn().mockRejectedValue(new Error('Unavailable')) }
  renderPlanner(projectFixture, gateway)
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  await user.click(screen.getByRole('button', { name: 'Change place' }))
  await user.type(screen.getByRole('combobox', { name: 'Place name' }), 'Seoul')
  await user.click(await screen.findByRole('option', { name: /Seoul Station/ }))
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByRole('form', { name: 'Edit place' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Late museum visit' })).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'Seoul Station' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('form', { name: 'Edit place' })).not.toBeInTheDocument()
})

it('blocks an edit save while another stop is being deleted', async () => {
  const user = userEvent.setup()
  const project = structuredClone(projectFixture)
  project.backendTripId = 'trip-1'
  project.days[0].activities[0].backendStopId = 'stop-1'
  project.days[0].activities.push({ ...project.days[0].activities[0], id: 912, name: 'Dinner', time: '18:00', backendStopId: 'stop-2' })
  let finishDelete!: (response: Response) => void
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finishDelete = resolve }))
  vi.stubGlobal('fetch', fetcher)
  renderPlanner(project, null)
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  await user.click(screen.getByRole('button', { name: 'Remove Dinner' }))
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  fireEvent.submit(screen.getByRole('form', { name: 'Edit place' }))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Back to itineraries' })).toBeDisabled()
  await act(async () => finishDelete(new Response(null, { status: 204 })))
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
})

it('clears a replacement preview when switching from Edit to Add', async () => {
  const user = userEvent.setup()
  const gateway: PlacesGateway = { suggest: vi.fn().mockResolvedValue([{ id: 'paris', text: 'Eiffel Tower', categories: [] }]), resolve: vi.fn().mockResolvedValue({ name: 'Eiffel Tower', address: 'Paris', category: 'Attraction', provider: 'amazon-location', region: 'us-east-1', location: { lat: 48.85, lng: 2.29 } }) }
  renderPlanner(projectFixture, gateway)
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  await user.click(screen.getByRole('button', { name: 'Change place' }))
  await user.type(screen.getByRole('combobox', { name: 'Place name' }), 'Eiffel')
  await user.click(await screen.findByRole('option', { name: /Eiffel Tower/ }))
  expect(screen.getByRole('img', { name: 'Preview location: Eiffel Tower' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Add a place' }))
  expect(screen.getByRole('combobox', { name: 'Place name' })).toHaveValue('')
  expect(screen.queryByRole('img', { name: 'Preview location: Eiffel Tower' })).not.toBeInTheDocument()
})

it('rejects overlaps on add and edit but allows adjacent activities and clearing a time', async () => {
  const user = userEvent.setup()
  renderPlanner(projectFixture, null)
  await user.click(screen.getByRole('button', { name: 'Add another place' }))
  await user.type(screen.getByLabelText('Place name'), 'Dinner')
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '16:00' } })
  await user.click(screen.getByRole('button', { name: 'Add to day' }))
  expect(screen.getByRole('alert')).toHaveTextContent('overlaps with Late museum visit')
  expect(screen.queryByRole('article', { name: 'Dinner' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '17:00' } })
  await user.click(screen.getByRole('button', { name: 'Add to day' }))
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  await user.clear(screen.getByLabelText('Duration'))
  await user.type(screen.getByLabelText('Duration'), '3 hr')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByRole('alert')).toHaveTextContent('overlaps with Dinner')
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '' } })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(within(screen.getByRole('article', { name: 'Late museum visit' })).getByText('Time not set')).toBeInTheDocument()
})

it('rejects an overnight conflict before sending an edit to the backend', async () => {
  const user = userEvent.setup()
  const project = structuredClone(projectFixture)
  project.backendTripId = 'trip-1'
  project.days[0].activities[0] = { ...project.days[0].activities[0], time: '23:30', duration: '1 hr' }
  project.days[1].activities = [{ ...project.days[0].activities[0], id: 912, backendStopId: 'stop-2', name: 'Breakfast', time: '08:00' }]
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  renderPlanner(project, null)
  await user.click(screen.getByRole('button', { name: /Day 2/ }))
  await user.click(screen.getByRole('button', { name: 'Edit Breakfast' }))
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '00:00' } })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(screen.getByRole('alert')).toHaveTextContent('overlaps with Late museum visit')
  expect(fetcher).not.toHaveBeenCalled()
  expect(within(screen.getByRole('article', { name: 'Breakfast' })).getByText('08:00')).toBeInTheDocument()
})


it.each(['', '   ', 'New address'])('removes the old pin after editing an address to %j without a search provider', async (address) => {
  const user = userEvent.setup()
  renderPlanner(projectFixture, null)
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  const form = screen.getByRole('form', { name: 'Edit place' })
  fireEvent.change(within(form).getByLabelText(/Address/), { target: { value: address } })
  await user.click(within(form).getByRole('button', { name: 'Save changes' }))
  expect(within(screen.getByRole('article', { name: 'Late museum visit' })).getByText('Not shown on map')).toBeInTheDocument()
})

it('resolves an edited address before moving its saved pin', async () => {
  const user = userEvent.setup()
  const gateway: PlacesGateway = { suggest: vi.fn(), resolve: vi.fn().mockResolvedValue({ name: 'Paris', address: 'Paris', category: 'Other', provider: 'amazon-location', region: 'us-east-1', location: { lat: 48.85, lng: 2.29 } }) }
  renderPlanner(projectFixture, gateway)
  await user.click(screen.getByRole('button', { name: 'Edit Late museum visit' }))
  const form = screen.getByRole('form', { name: 'Edit place' })
  fireEvent.change(within(form).getByLabelText(/Address/), { target: { value: 'Paris' } })
  await user.click(within(form).getByRole('button', { name: 'Save changes' }))
  expect(gateway.resolve).toHaveBeenCalledWith(expect.objectContaining({ text: 'Paris' }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(within(screen.getByRole('article', { name: 'Late museum visit' })).queryByText('Not shown on map')).not.toBeInTheDocument()
})
