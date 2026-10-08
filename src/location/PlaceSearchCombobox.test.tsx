import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PlacesGateway, ResolvedPlace } from './amazon-location'
import { AmazonLocationRequestError } from './amazon-location'
import { PlaceSearchCombobox } from './PlaceSearchCombobox'

const resolvedPlace: ResolvedPlace = {
  placeId: 'place-1',
  name: 'Fushimi Inari Taisha',
  address: 'Fushimi Inari Taisha, 68 Fukakusa Yabunouchicho, Kyoto, Japan',
  category: 'Attraction',
  location: { lat: 34.9671, lng: 135.7727 },
  provider: 'amazon-location',
  region: 'us-east-1',
}

function createGateway(overrides: Partial<PlacesGateway> = {}): PlacesGateway {
  return {
    suggest: vi.fn().mockResolvedValue([
      {
        id: 'place-1',
        placeId: 'place-1',
        text: 'Fushimi Inari Taisha, Kyoto, Japan',
        categories: ['Tourist Attraction'],
      },
      {
        id: 'place-2',
        placeId: 'place-2',
        text: 'Fushimi Ward, Kyoto, Japan',
        categories: [],
      },
    ]),
    resolve: vi.fn().mockResolvedValue(resolvedPlace),
    ...overrides,
  }
}

function renderCombobox(gateway: PlacesGateway) {
  function Harness() {
    const [value, setValue] = useState('')
    const [place, setPlace] = useState<ResolvedPlace | null>(null)
    return (
      <>
        <PlaceSearchCombobox
          gateway={gateway}
          onPlaceSelect={setPlace}
          onValueChange={setValue}
          value={value}
        />
        <output>{place?.address}</output>
      </>
    )
  }

  return render(<Harness />)
}

describe('PlaceSearchCombobox', () => {
  it('loads suggestions and supports keyboard selection and resolution', async () => {
    const user = userEvent.setup()
    const gateway = createGateway()
    renderCombobox(gateway)

    const input = screen.getByRole('combobox', { name: 'Place name' })
    await user.type(input, 'Fushimi')

    expect(await screen.findByRole('option', { name: /Fushimi Inari Taisha/i })).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(gateway.resolve).toHaveBeenCalled())
    expect(input).toHaveValue('Fushimi Inari Taisha')
    expect(screen.getByText(resolvedPlace.address)).toBeInTheDocument()
    expect(input).toHaveFocus()
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    expect(gateway.suggest).toHaveBeenCalledOnce()
    expect(screen.queryByRole('listbox', { name: 'Place suggestions' })).not.toBeInTheDocument()
  })

  it('announces no results and keeps manual entry available', async () => {
    const user = userEvent.setup()
    renderCombobox(createGateway({ suggest: vi.fn().mockResolvedValue([]) }))

    await user.type(screen.getByRole('combobox', { name: 'Place name' }), 'Unknown place')

    expect(await screen.findByText('No matching places. You can still enter it manually.')).toBeInTheDocument()
  })

  it('shows a safe retryable error without discarding the entered query', async () => {
    const user = userEvent.setup()
    const suggest = vi.fn()
      .mockRejectedValueOnce(new AmazonLocationRequestError('throttled', 'Place search is busy. Wait a moment and try again.'))
      .mockResolvedValueOnce([])
    renderCombobox(createGateway({ suggest }))

    const input = screen.getByRole('combobox', { name: 'Place name' })
    await user.type(input, 'Fushimi')

    expect(await screen.findByRole('alert')).toHaveTextContent('Place search is busy')
    expect(input).toHaveValue('Fushimi')
    await user.click(screen.getByRole('button', { name: 'Retry place search' }))
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(2))
  })

  it('closes an error popup with Escape while preserving the manual query', async () => {
    const user = userEvent.setup()
    renderCombobox(createGateway({
      suggest: vi.fn().mockRejectedValue(
        new AmazonLocationRequestError('unavailable', 'Place search is temporarily unavailable.'),
      ),
    }))

    const input = screen.getByRole('combobox', { name: 'Place name' })
    await user.type(input, 'Fushimi')
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(input).toHaveValue('Fushimi')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('prevents an aborted older query from replacing newer suggestions', async () => {
    const user = userEvent.setup()
    let resolveOlder: ((suggestions: Awaited<ReturnType<PlacesGateway['suggest']>>) => void) | undefined
    const suggest = vi.fn((query: string) => {
      if (query === 'Older') {
        return new Promise<Awaited<ReturnType<PlacesGateway['suggest']>>>((resolve) => {
          resolveOlder = resolve
        })
      }
      return Promise.resolve([{
        id: 'newer-place',
        placeId: 'newer-place',
        text: 'Newer place, New Zealand',
        categories: [],
      }])
    })
    renderCombobox(createGateway({ suggest }))

    const input = screen.getByRole('combobox', { name: 'Place name' })
    await user.type(input, 'Older')
    await waitFor(() => expect(suggest).toHaveBeenCalledWith('Older', expect.anything()))
    await user.clear(input)
    await user.type(input, 'Newer')

    expect(await screen.findByRole('option', { name: /Newer place/i })).toBeInTheDocument()
    resolveOlder?.([{
      id: 'older-place',
      placeId: 'older-place',
      text: 'Older place, New Zealand',
      categories: [],
    }])

    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(screen.queryByRole('option', { name: /Older place/i })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Newer place/i })).toBeInTheDocument()
  })

  it('aborts an in-flight place resolution when the combobox unmounts', async () => {
    const user = userEvent.setup()
    let resolutionSignal: AbortSignal | undefined
    const resolve = vi.fn((_suggestion, options) => {
      resolutionSignal = options?.signal
      return new Promise<ResolvedPlace>(() => undefined)
    })
    const view = renderCombobox(createGateway({ resolve }))

    await user.type(screen.getByRole('combobox', { name: 'Place name' }), 'Fushimi')
    await user.click(await screen.findByRole('option', { name: /Fushimi Inari Taisha/i }))
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolutionSignal?.aborted).toBe(false)

    view.unmount()

    expect(resolutionSignal?.aborted).toBe(true)
  })
})

it('ignores an older place resolution after selecting a result from a newer search', async () => {
  const user = userEvent.setup()
  let finishOld!: (place: ResolvedPlace) => void
  const gateway: PlacesGateway = {
    suggest: vi.fn(async (query) => [{ id: query, text: query, categories: [] }]),
    resolve: vi.fn((suggestion) => suggestion.id === 'Paris'
      ? new Promise<ResolvedPlace>((resolve) => { finishOld = resolve })
      : Promise.resolve<ResolvedPlace>({ ...resolvedPlace, name: 'Seoul Station', address: 'Seoul, South Korea', category: 'Transport' })),
  }
  renderCombobox(gateway)
  const input = screen.getByRole('combobox', { name: 'Place name' })
  await user.type(input, 'Paris')
  await user.click(await screen.findByRole('option', { name: /Paris/ }))
  await user.clear(input)
  await user.type(input, 'Seoul')
  await user.click(await screen.findByRole('option', { name: /Seoul/ }))
  await waitFor(() => expect(input).toHaveValue('Seoul Station'))
  await act(async () => finishOld({ ...resolvedPlace, name: 'Eiffel Tower', address: 'Paris, France' }))
  expect(input).toHaveValue('Seoul Station')
  expect(screen.getByText('Seoul, South Korea')).toBeInTheDocument()
  expect(screen.queryByText('Paris, France')).not.toBeInTheDocument()
})
