import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { GeoPlacesClient, GeocodeCommand, GetPlaceCommand, type GetPlaceCommandOutput } from '@aws-sdk/client-geo-places'
import { createStop } from './createStop.js'

const ddbMock = mockClient(DynamoDBDocumentClient)
const placesMock = mockClient(GeoPlacesClient)

beforeEach(() => {
  ddbMock.reset()
  ddbMock.on(GetCommand).resolves({})
  ddbMock.on(QueryCommand).resolves({ Items: [] })
  placesMock.reset()
  placesMock.on(GeocodeCommand).resolves({ ResultItems: [] })
})

const samplePlaceResponse: Partial<GetPlaceCommandOutput> = {
  PlaceId: 'place-123',
  PlaceType: 'PointOfInterest',
  Title: 'Fushimi Inari Taisha',
  PricingBucket: 'Core',
  Address: { Label: '68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto' },
  Position: [135.7727, 34.9671],
  Categories: [{ Id: 'cat-1', Name: 'Shrine', Primary: true }],
}

describe('createStop', () => {
  it('fetches place details, assigns the first order value, and writes the stop', async () => {
    placesMock.on(GetPlaceCommand).resolves(samplePlaceResponse)
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        placeId: 'place-123',
        visitDurationMinutes: 120,
        priority: 3,
        date: '2027-04-21',
        time: '09:30',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.placeName).toBe('Fushimi Inari Taisha')
    expect(stop.location).toEqual({ lat: 34.9671, lng: 135.7727 })
    expect(stop.order).toBe(1000)
    expect(stop.category).toBe('Attraction')
    expect(stop.time).toBe('09:30')
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1)
  })

  it('stores trimmed notes, and the client-supplied address, for a manually entered place', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        manualPlace: { name: 'The Sushi House' },
        visitDurationMinutes: 60,
        priority: 2,
        notes: '  Meet at the east gate.  ',
        address: '  68 Fukakusa Yabunouchicho  ',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.notes).toBe('Meet at the east gate.')
    expect(stop.address).toBe('68 Fukakusa Yabunouchicho')
  })

  it('preserves the confirmed address when a placeId lookup succeeds', async () => {
    placesMock.on(GetPlaceCommand).resolves(samplePlaceResponse)
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        placeId: 'place-123',
        visitDurationMinutes: 60,
        priority: 2,
        address: 'some address the client typed earlier',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.address).toBe('some address the client typed earlier')
  })

  it('omits notes and address when not given', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      { tripId: 'trip-1', userId: 'user-1', manualPlace: { name: 'The Sushi House' }, visitDurationMinutes: 60, priority: 2 },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.notes).toBeUndefined()
    expect(stop.address).toBeUndefined()
  })

  it('rejects a manual place name that is only whitespace', async () => {
    await expect(
      createStop(
        { tripId: 'trip-1', userId: 'user-1', manualPlace: { name: '   ' }, visitDurationMinutes: 60, priority: 2 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('trims surrounding whitespace from a manual place name before storing', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      { tripId: 'trip-1', userId: 'user-1', manualPlace: { name: '  The Sushi House  ' }, visitDurationMinutes: 60, priority: 2 },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.placeName).toBe('The Sushi House')
  })

  it('rejects a date or time that is an array instead of a string, rather than coercing it via regex', async () => {
    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          manualPlace: { name: 'The Sushi House' },
          visitDurationMinutes: 60,
          priority: 2,
          date: ['2027-01-01'] as unknown as string,
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          manualPlace: { name: 'The Sushi House' },
          visitDurationMinutes: 60,
          priority: 2,
          time: ['09:00'] as unknown as string,
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('uses the client-supplied category for a manually entered place, since there is no resolved place data to derive one from', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        manualPlace: { name: 'The Sushi House' },
        visitDurationMinutes: 60,
        priority: 2,
        category: 'Food',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.category).toBe('Food')
  })

  it('defaults a manual place to Other when no category is given', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      { tripId: 'trip-1', userId: 'user-1', manualPlace: { name: 'The Sushi House' }, visitDurationMinutes: 60, priority: 2 },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.category).toBe('Other')
  })

  it('preserves the confirmed category when the provider suggests another', async () => {
    placesMock.on(GetPlaceCommand).resolves(samplePlaceResponse)
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        placeId: 'place-123',
        visitDurationMinutes: 60,
        priority: 2,
        category: 'Food',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.category).toBe('Food')
  })

  it('rejects a category that is not one of the known activity categories', async () => {
    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          manualPlace: { name: 'The Sushi House' },
          visitDurationMinutes: 60,
          priority: 2,
          category: 'Nonsense' as never,
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')
  })

  it('rejects notes or address that exceed the length limit', async () => {
    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          placeId: 'place-123',
          visitDurationMinutes: 60,
          priority: 2,
          notes: 'a'.repeat(2001),
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          placeId: 'place-123',
          visitDurationMinutes: 60,
          priority: 2,
          address: 'a'.repeat(301),
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')
  })

  it('rejects non-finite visitDurationMinutes or priority values', async () => {
    const baseInput = { tripId: 'trip-1', userId: 'user-1', placeId: 'place-123' }

    await expect(
      createStop(
        { ...baseInput, visitDurationMinutes: Infinity, priority: 1 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    await expect(
      createStop(
        { ...baseInput, visitDurationMinutes: 60, priority: NaN },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    await expect(
      createStop(
        { ...baseInput, visitDurationMinutes: 60, priority: Infinity },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    expect(placesMock.commandCalls(GetPlaceCommand)).toHaveLength(0)
  })

  it('rejects a duration or priority outside the allowed range', async () => {
    const baseInput = { tripId: 'trip-1', userId: 'user-1', placeId: 'place-123' }

    await expect(
      createStop(
        { ...baseInput, visitDurationMinutes: 1441, priority: 1 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    await expect(
      createStop(
        { ...baseInput, visitDurationMinutes: 60, priority: 6 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    await expect(
      createStop(
        { ...baseInput, visitDurationMinutes: 60, priority: 0 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')
  })

  it('rejects a manually entered place name that exceeds the length limit', async () => {
    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          manualPlace: { name: 'a'.repeat(201) },
          visitDurationMinutes: 60,
          priority: 2,
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')
  })

  it('rejects a stop date outside the trip\'s own start/end date range', async () => {
    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          manualPlace: { name: 'The Sushi House' },
          visitDurationMinutes: 60,
          priority: 2,
          date: '2027-05-01',
          tripStartDate: '2027-04-21',
          tripEndDate: '2027-04-24',
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')
  })

  it('accepts a stop date within the trip\'s start/end date range', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        manualPlace: { name: 'The Sushi House' },
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-22',
        tripStartDate: '2027-04-21',
        tripEndDate: '2027-04-24',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.date).toBe('2027-04-22')
  })

  it('rejects a stale or invalid placeId as a clean validation error, not a raw AWS error', async () => {
    const notFound = new Error('Place not found')
    notFound.name = 'ResourceNotFoundException'
    placesMock.on(GetPlaceCommand).rejects(notFound)

    await expect(
      createStop(
        { tripId: 'trip-1', userId: 'user-1', placeId: 'stale-place-id', visitDurationMinutes: 60, priority: 1 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Could not find a place matching placeId "stale-place-id"')

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('re-throws an unrelated AWS error from place lookup as-is, for the handler to classify as a server error', async () => {
    const throttled = new Error('Rate exceeded')
    throttled.name = 'ThrottlingException'
    placesMock.on(GetPlaceCommand).rejects(throttled)

    await expect(
      createStop(
        { tripId: 'trip-1', userId: 'user-1', placeId: 'place-123', visitDurationMinutes: 60, priority: 1 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Rate exceeded')
  })

  it('rejects an invalid time value', async () => {
    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          placeId: 'place-123',
          visitDurationMinutes: 60,
          priority: 1,
          time: '25:99',
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    expect(placesMock.commandCalls(GetPlaceCommand)).toHaveLength(0)
  })

  it('assigns the next gapped order after existing stops on the same day', async () => {
    placesMock.on(GetPlaceCommand).resolves(samplePlaceResponse)
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 3 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        placeId: 'place-123',
        visitDurationMinutes: 60,
        priority: 1,
        date: '2027-04-21',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.order).toBe(3000)
  })

  it('rejects a syntactically valid but impossible calendar date', async () => {
    await expect(
      createStop(
        {
          tripId: 'trip-1',
          userId: 'user-1',
          placeId: 'place-123',
          visitDurationMinutes: 60,
          priority: 1,
          date: '2027-02-30',
        },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    expect(placesMock.commandCalls(GetPlaceCommand)).toHaveLength(0)
  })

  it('creates a manual stop from a given name and location without calling GetPlace', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    const stop = await createStop(
      {
        tripId: 'trip-1',
        userId: 'user-1',
        manualPlace: { name: 'the house', location: { lat: -36.8485, lng: 174.7633 } },
        visitDurationMinutes: 60,
        priority: 2,
        date: '2027-04-21',
      },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    expect(stop.placeName).toBe('the house')
    expect(stop.location).toEqual({ lat: -36.8485, lng: 174.7633 })
    expect(stop.category).toBe('Other')
    expect(placesMock.commandCalls(GetPlaceCommand)).toHaveLength(0)
  })

  it('rejects input with neither a placeId nor a manual place name', async () => {
    await expect(
      createStop(
        { tripId: 'trip-1', userId: 'user-1', visitDurationMinutes: 60, priority: 1 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')
  })

  it('rejects invalid input without calling either AWS service', async () => {
    await expect(
      createStop(
        { tripId: 'trip-1', userId: 'user-1' },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')

    expect(placesMock.commandCalls(GetPlaceCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  })

  it('rejects input missing userId, since it is required to guard against a concurrently deleted trip', async () => {
    await expect(
      createStop(
        { tripId: 'trip-1', placeId: 'place-123', visitDurationMinutes: 60, priority: 1 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('Invalid stop input')
  })

  it('rejects the write and reports a clear error when the trip was deleted concurrently', async () => {
    placesMock.on(GetPlaceCommand).resolves(samplePlaceResponse)
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    const cancelled = new Error('Transaction cancelled')
    cancelled.name = 'TransactionCanceledException'
    ddbMock.on(TransactWriteCommand).rejects(cancelled)

    await expect(
      createStop(
        { tripId: 'trip-1', userId: 'user-1', placeId: 'place-123', visitDurationMinutes: 60, priority: 1 },
        ddbMock as unknown as DynamoDBDocumentClient,
        placesMock as unknown as GeoPlacesClient,
      ),
    ).rejects.toThrow('The trip or schedule changed')
  })

  it('includes a check against the trip\'s deleting flag in the same transaction, not just that it exists', async () => {
    placesMock.on(GetPlaceCommand).resolves(samplePlaceResponse)
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
    ddbMock.on(TransactWriteCommand).resolves({})

    await createStop(
      { tripId: 'trip-1', userId: 'user-1', placeId: 'place-123', visitDurationMinutes: 60, priority: 1 },
      ddbMock as unknown as DynamoDBDocumentClient,
      placesMock as unknown as GeoPlacesClient,
    )

    const call = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input
    const conditionCheck = call.TransactItems?.[0]?.ConditionCheck
    expect(conditionCheck?.ConditionExpression).toBe('attribute_exists(tripId) AND attribute_not_exists(deleting)')
    expect(conditionCheck?.Key).toEqual({ userId: 'user-1', tripId: 'trip-1' })
  })
})


it('rejects a create that overlaps a saved activity before calling Places or writing', async () => {
  ddbMock.on(GetCommand).resolves({})
  ddbMock.on(QueryCommand).resolves({ Items: [{ stopId: 'existing', date: '2027-04-21', time: '09:00', visitDurationMinutes: 60, placeName: 'Museum' }] })
  await expect(createStop({ tripId: 'trip-1', userId: 'user-1', manualPlace: { name: 'Cafe' }, date: '2027-04-21', time: '09:30', visitDurationMinutes: 60, priority: 3 }, ddbMock as unknown as DynamoDBDocumentClient)).rejects.toThrow('overlaps')
  expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
  expect(placesMock.calls()).toHaveLength(0)
})

it('guards simultaneous creates against accepting the same schedule snapshot twice', async () => {
  let revision = 0
  const written: unknown[] = []
  ddbMock.on(GetCommand).resolves({})
  ddbMock.on(QueryCommand).resolves({ Items: [] })
  ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
  ddbMock.on(TransactWriteCommand).callsFake((input) => {
    const guard = input.TransactItems[0].Update
    expect(guard.Key.stopId).toBe('#order#schedule')
    expect(guard.ConditionExpression).toBe('attribute_not_exists(revision)')
    if (revision) throw Object.assign(new Error('Conflicting write'), { name: 'TransactionCanceledException' })
    revision = guard.ExpressionAttributeValues[':next']
    written.push(input.TransactItems[2].Put.Item)
    return {}
  })
  const input = { tripId: 'trip-1', userId: 'user-1', manualPlace: { name: 'Museum' }, date: '2027-04-21', time: '09:00', visitDurationMinutes: 60, priority: 3 }
  const results = await Promise.allSettled([createStop(input, ddbMock as unknown as DynamoDBDocumentClient), createStop(input, ddbMock as unknown as DynamoDBDocumentClient)])
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(written).toHaveLength(1)
})


it.each(['', 'Paris'])('uses the confirmed address %j for a newly selected place pin', async (address) => {
  placesMock.on(GetPlaceCommand).resolves(samplePlaceResponse)
  placesMock.on(GeocodeCommand).resolves({ ResultItems: [{ PlaceId: 'paris', PlaceType: 'PointAddress', Title: 'Paris', Position: [2.29, 48.85] }] })
  ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })
  ddbMock.on(TransactWriteCommand).resolves({})
  const stop = await createStop({ tripId: 'trip-1', userId: 'user-1', placeId: 'place-123', visitDurationMinutes: 60, priority: 3, address }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)
  expect(stop.location).toEqual(address ? { lat: 48.85, lng: 2.29 } : undefined)
})
