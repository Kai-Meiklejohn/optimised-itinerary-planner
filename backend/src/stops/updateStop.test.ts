import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { GeoPlacesClient, GeocodeCommand, GetPlaceCommand } from '@aws-sdk/client-geo-places'
import { updateStop, validateUpdateStopInput } from './updateStop.js'

const placesMock = mockClient(GeoPlacesClient)
const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
  ddbMock.on(GetCommand).resolves({})
  // Default: the target stop itself, for computeReorderedPosition's same-day
  // check - individual reorder tests override neighbour-specific keys too.
  ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-1' } }).resolves({
    Item: { tripId: 'trip-1', stopId: 'stop-1', date: '2027-04-21' },
  })
  ddbMock.on(QueryCommand).resolves({ Items: [{ tripId: 'trip-1', stopId: 'stop-1', date: '2027-04-21', time: '08:00', visitDurationMinutes: 60 }] })
  ddbMock.on(TransactWriteCommand).resolves({})
  placesMock.reset()
  placesMock.on(GeocodeCommand).resolves({ ResultItems: [] })
})

function lastStopUpdate() {
  const transaction = ddbMock.commandCalls(TransactWriteCommand).at(-1)
  // The main Update is always the last item in the transaction, regardless
  // of how many guard/ConditionCheck items (schedule revision, order guards)
  // precede it.
  return transaction?.args[0].input.TransactItems?.at(-1)?.Update
    ?? ddbMock.commandCalls(UpdateCommand).at(-1)!.args[0].input
}

describe('validateUpdateStopInput', () => {
  it('rejects an empty update', () => {
    expect(validateUpdateStopInput({})).toBe(false)
  })

  it('rejects an invalid time', () => {
    expect(validateUpdateStopInput({ time: '25:99' })).toBe(false)
  })

  it('accepts a valid time', () => {
    expect(validateUpdateStopInput({ time: '09:30' })).toBe(true)
  })

  it('accepts a notes-only update, including clearing it to an empty string', () => {
    expect(validateUpdateStopInput({ notes: 'Meet at the east gate.' })).toBe(true)
    expect(validateUpdateStopInput({ notes: '' })).toBe(true)
  })

  it('accepts clearing the time to an empty string', () => {
    expect(validateUpdateStopInput({ time: '' })).toBe(true)
  })

  it('rejects notes that exceed the length limit', () => {
    expect(validateUpdateStopInput({ notes: 'a'.repeat(2001) })).toBe(false)
  })

  it('rejects a time that is an array instead of a string, rather than coercing it via regex', () => {
    expect(validateUpdateStopInput({ time: ['09:00'] as unknown as string })).toBe(false)
  })

  it('accepts a reorder with only previousStopId or only nextStopId', () => {
    expect(validateUpdateStopInput({ previousStopId: 'stop-1' })).toBe(true)
    expect(validateUpdateStopInput({ nextStopId: 'stop-2' })).toBe(true)
  })

  it('rejects an empty-string neighbour id', () => {
    expect(validateUpdateStopInput({ previousStopId: '' })).toBe(false)
    expect(validateUpdateStopInput({ nextStopId: '' })).toBe(false)
  })

  it('rejects a neighbour id that is not a string', () => {
    expect(validateUpdateStopInput({ previousStopId: 123 as unknown as string })).toBe(false)
  })

  it('rejects an oversized neighbour id', () => {
    expect(validateUpdateStopInput({ previousStopId: 'x'.repeat(101) })).toBe(false)
    expect(validateUpdateStopInput({ nextStopId: 'x'.repeat(101) })).toBe(false)
  })

  it('rejects a neighbour id pointing at an internal order-counter row', () => {
    expect(validateUpdateStopInput({ previousStopId: '#order#2027-04-21' })).toBe(false)
    expect(validateUpdateStopInput({ nextStopId: '#order#undated' })).toBe(false)
  })

  it('rejects reordering a stop between a neighbour and itself', () => {
    expect(validateUpdateStopInput({ previousStopId: 'stop-2', nextStopId: 'stop-2' })).toBe(false)
  })
})

describe('updateStop', () => {
  it('updates the time and returns the updated stop', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { tripId: 'trip-1', stopId: 'stop-1', time: '09:30' },
    })

    const stop = await updateStop('trip-1', 'stop-1', { time: '09:30' }, ddbMock as unknown as DynamoDBDocumentClient)

    expect(stop?.time).toBe('09:30')
    const call = lastStopUpdate()
    expect(call.Key).toEqual({ tripId: 'trip-1', stopId: 'stop-1' })
  })

  it('rejects invalid input without calling DynamoDB', async () => {
    await expect(
      updateStop('trip-1', 'stop-1', { time: 'not-a-time' }, ddbMock as unknown as DynamoDBDocumentClient),
    ).rejects.toThrow('Invalid stop update input')

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('returns undefined when the stop does not exist', async () => {
    const notFound = new Error('conditional check failed')
    notFound.name = 'ConditionalCheckFailedException'
    ddbMock.on(UpdateCommand).rejects(notFound)

    const stop = await updateStop('trip-1', 'missing-stop', { time: '09:30' }, ddbMock as unknown as DynamoDBDocumentClient)

    expect(stop).toBeUndefined()
  })

  it('updates notes and returns the updated stop', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { tripId: 'trip-1', stopId: 'stop-1', notes: 'Meet at the east gate.' },
    })

    const stop = await updateStop(
      'trip-1',
      'stop-1',
      { notes: '  Meet at the east gate.  ' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(stop?.notes).toBe('Meet at the east gate.')
    const call = lastStopUpdate()
    expect(call.UpdateExpression).toBe('SET #notes = :notes')
    expect(call.ExpressionAttributeValues).toEqual({ ':notes': 'Meet at the east gate.' })
  })

  it('removes notes from the item when cleared to an empty string, instead of writing an undefined value', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { tripId: 'trip-1', stopId: 'stop-1' },
    })

    await updateStop('trip-1', 'stop-1', { notes: '   ' }, ddbMock as unknown as DynamoDBDocumentClient)

    const call = lastStopUpdate()
    expect(call.UpdateExpression).toBe('REMOVE #notes')
    expect(call.ExpressionAttributeValues).toBeUndefined()
  })

  it('removes the time from the item when cleared to an empty string, instead of rejecting the update', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { tripId: 'trip-1', stopId: 'stop-1' },
    })

    await updateStop('trip-1', 'stop-1', { time: '' }, ddbMock as unknown as DynamoDBDocumentClient)

    const call = lastStopUpdate()
    expect(call.UpdateExpression).toBe('REMOVE #time')
    expect(call.ExpressionAttributeValues).toBeUndefined()
  })

  it('updates both time and notes together in a single expression', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { tripId: 'trip-1', stopId: 'stop-1', time: '09:30', notes: 'Bring tickets.' },
    })

    await updateStop(
      'trip-1',
      'stop-1',
      { time: '09:30', notes: 'Bring tickets.' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const call = lastStopUpdate()
    expect(call.UpdateExpression).toBe('SET #time = :time, #notes = :notes')
  })

  it('reorders a stop to the midpoint between two neighbours', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 1000, date: '2027-04-21' },
    })
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-after' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-after', order: 2000, date: '2027-04-21' },
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { tripId: 'trip-1', stopId: 'stop-1', order: 1500 } })

    await updateStop(
      'trip-1',
      'stop-1',
      { previousStopId: 'stop-before', nextStopId: 'stop-after' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const call = lastStopUpdate()
    expect(call.UpdateExpression).toBe('SET #order = :order')
    expect(call.ExpressionAttributeValues).toEqual({ ':order': 1500 })
  })

  it('moves a stop to the end of the day when only previousStopId is given', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 3000, date: '2027-04-21' },
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { tripId: 'trip-1', stopId: 'stop-1', order: 4000 } })

    await updateStop(
      'trip-1',
      'stop-1',
      { previousStopId: 'stop-before' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const call = lastStopUpdate()
    expect(call.ExpressionAttributeValues).toEqual({ ':order': 4000 })
  })

  it('moving a stop to the end never hands out an order value a later-created stop could collide with', async () => {
    // The day's own order counter (orderCounter.ts) has raced ahead of this
    // neighbour's order - e.g. several stops were created and deleted since -
    // so previousOrder + ORDER_GAP (3000 + 1000 = 4000) would land behind
    // where the next createStop's counter-based order is headed.
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 3000, date: '2027-04-21' },
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 10 } })

    await updateStop(
      'trip-1',
      'stop-1',
      { previousStopId: 'stop-before' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const call = lastStopUpdate()
    expect(call.ExpressionAttributeValues).toEqual({ ':order': 10000 })
  })

  it('moves a stop to the start of the day when only nextStopId is given', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-after' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-after', order: 1000, date: '2027-04-21' },
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { tripId: 'trip-1', stopId: 'stop-1', order: 0 } })

    await updateStop(
      'trip-1',
      'stop-1',
      { nextStopId: 'stop-after' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const call = lastStopUpdate()
    expect(call.ExpressionAttributeValues).toEqual({ ':order': 0 })
  })

  it('rejects reordering against a neighbour that does not exist, without writing anything', async () => {
    await expect(
      updateStop(
        'trip-1',
        'stop-1',
        { previousStopId: 'missing-stop' },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Could not find a neighbouring stop "missing-stop" to reorder against')

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('rejects reordering a stop relative to itself', async () => {
    await expect(
      updateStop(
        'trip-1',
        'stop-1',
        { previousStopId: 'stop-1' },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('A stop cannot be reordered relative to itself')

    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('rejects reordering between two neighbours that leave no room between them', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 1000, date: '2027-04-21' },
    })
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-after' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-after', order: 1000, date: '2027-04-21' },
    })

    await expect(
      updateStop(
        'trip-1',
        'stop-1',
        { previousStopId: 'stop-before', nextStopId: 'stop-after' },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('No space left between these two stops - move it next to a different stop first')

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('rejects reordering against a neighbour from a different day', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-other-day' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-other-day', order: 1000, date: '2027-04-22' },
    })

    await expect(
      updateStop(
        'trip-1',
        'stop-1',
        { previousStopId: 'stop-other-day' },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Cannot reorder a stop relative to a stop on a different day')

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  })

  it('combines a reorder with a time update in one call', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 1000, date: '2027-04-21' },
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { tripId: 'trip-1', stopId: 'stop-1', order: 2000, time: '11:00' } })

    await updateStop(
      'trip-1',
      'stop-1',
      { previousStopId: 'stop-before', time: '11:00' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const call = lastStopUpdate()
    expect(call.UpdateExpression).toBe('SET #order = :order, #time = :time')
    expect(call.ExpressionAttributeValues).toEqual({ ':order': 2000, ':time': '11:00' })
  })

  it('guards a reorder write against both neighbours\' order having changed since they were read', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 1000, date: '2027-04-21' },
    })
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-after' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-after', order: 2000, date: '2027-04-21' },
    })

    await updateStop(
      'trip-1',
      'stop-1',
      { previousStopId: 'stop-before', nextStopId: 'stop-after' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    const transaction = ddbMock.commandCalls(TransactWriteCommand).at(-1)!.args[0].input
    expect(transaction.TransactItems).toHaveLength(3)
    expect(transaction.TransactItems?.[0].ConditionCheck).toMatchObject({
      Key: { tripId: 'trip-1', stopId: 'stop-before' },
      ConditionExpression: 'attribute_exists(stopId) AND #order = :expectedOrder',
      ExpressionAttributeValues: { ':expectedOrder': 1000 },
    })
    expect(transaction.TransactItems?.[1].ConditionCheck).toMatchObject({
      Key: { tripId: 'trip-1', stopId: 'stop-after' },
      ExpressionAttributeValues: { ':expectedOrder': 2000 },
    })
    expect(transaction.TransactItems?.[2].Update?.Key).toEqual({ tripId: 'trip-1', stopId: 'stop-1' })
  })

  it('rejects a reorder when a neighbour\'s order changed concurrently, without silently colliding', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 1000, date: '2027-04-21' },
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 2 } })
    ddbMock.on(TransactWriteCommand).rejects(Object.assign(new Error('Concurrent change'), {
      name: 'TransactionCanceledException',
      // The order-guard (index 0) failed; the main update (index 1) never ran.
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
    }))

    await expect(
      updateStop(
        'trip-1',
        'stop-1',
        { previousStopId: 'stop-before' },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('This stop\'s position changed. Reload the itinerary and try again.')
  })

  it('returns undefined (not an error) when the stop itself was deleted during a reorder', async () => {
    ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: 'stop-before' } }).resolves({
      Item: { tripId: 'trip-1', stopId: 'stop-before', order: 1000, date: '2027-04-21' },
    })
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 2 } })
    ddbMock.on(TransactWriteCommand).rejects(Object.assign(new Error('Stop gone'), {
      name: 'TransactionCanceledException',
      // The guard (index 0) passed; the main update (index 1, last) is what failed.
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
    }))

    const result = await updateStop(
      'trip-1',
      'stop-1',
      { previousStopId: 'stop-before' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(result).toBeUndefined()
  })
})

it('saves all editable details atomically without changing the place identity', async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: { category: 'Stay', visitDurationMinutes: 90, address: 'East entrance' } })
  const result = await updateStop('trip-1', 'stop-1', { category: 'Stay', visitDurationMinutes: 90, address: ' East entrance ', time: '13:00', notes: 'Tickets' }, ddbMock as unknown as DynamoDBDocumentClient)
  expect(result?.category).toBe('Stay')
  const command = lastStopUpdate()
  expect(command.ExpressionAttributeValues).toMatchObject({ ':category': 'Stay', ':visitDurationMinutes': 90, ':address': 'East entrance', ':notes': 'Tickets' })
  expect(command.ExpressionAttributeNames).not.toHaveProperty('#placeName')
})

it.each([{ category: 'Invalid' }, { visitDurationMinutes: 0 }, { visitDurationMinutes: 1441 }, { visitDurationMinutes: NaN }, { address: 'x'.repeat(501) }, { placeId: '' }, { placeName: 'Custom name' }])('rejects invalid editable details %j', async (input) => {
  await expect(updateStop('trip-1', 'stop-1', input as never, ddbMock as unknown as DynamoDBDocumentClient)).rejects.toThrow('Invalid stop update input')
  expect(ddbMock.calls()).toHaveLength(0)
})

it('clears the saved location when address and notes are removed', async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} })
  await updateStop('trip-1', 'stop-1', { address: '', notes: '' }, ddbMock as unknown as DynamoDBDocumentClient)
  const command = lastStopUpdate()
  expect(command.UpdateExpression).toContain('#address')
  expect(command.UpdateExpression).toContain('#location')
  expect(command.ExpressionAttributeValues).toBeUndefined()
})

it('changes the selected place using English provider details while preserving the confirmed category', async () => {
  placesMock.on(GetPlaceCommand).resolves({ PlaceId: 'paris', Title: 'Eiffel Tower', Categories: [{ Id: 'restaurant', Name: 'Restaurant' }] })
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} })
  await updateStop('trip-1', 'stop-1', { placeId: 'paris', category: 'Attraction', address: 'South entrance' }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)
  const command = lastStopUpdate()
  expect(command.ExpressionAttributeValues).toMatchObject({ ':placeName': 'Eiffel Tower', ':placeId': 'paris', ':category': 'Attraction', ':address': 'South entrance' })
  expect(command.UpdateExpression).toContain('REMOVE #location')
  expect(placesMock.commandCalls(GetPlaceCommand)[0].args[0].input.Language).toBe('en')
})

it('does not save partial edits when changing place fails', async () => {
  placesMock.on(GetPlaceCommand).rejects(new Error('Unavailable'))
  await expect(updateStop('trip-1', 'stop-1', { placeId: 'paris', notes: 'New notes' }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)).rejects.toThrow('Unavailable')
  expect(ddbMock.calls()).toHaveLength(0)
})


it('rejects a duration edit overlapping the next day without saving any fields', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [
    { stopId: 'stop-1', date: '2027-04-21', time: '23:00', visitDurationMinutes: 60 },
    { stopId: 'stop-2', date: '2027-04-22', time: '00:30', visitDurationMinutes: 60, placeName: 'Night visit' },
  ] })
  await expect(updateStop('trip-1', 'stop-1', { visitDurationMinutes: 120, notes: 'Changed' }, ddbMock as unknown as DynamoDBDocumentClient)).rejects.toThrow('overlaps')
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
  expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
})

it('commits a schedule edit only if the scanned revision still matches', async () => {
  ddbMock.on(GetCommand, { Key: { tripId: 'trip-1', stopId: '#order#schedule' } }).resolves({ Item: { revision: 7 } })
  ddbMock.on(TransactWriteCommand).rejects(Object.assign(new Error('Concurrent change'), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
  }))
  await expect(updateStop('trip-1', 'stop-1', { time: '10:00' }, ddbMock as unknown as DynamoDBDocumentClient)).rejects.toThrow('schedule changed')
  const transaction = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input
  expect(transaction.TransactItems?.[0].Update).toMatchObject({ ConditionExpression: 'revision = :revision', ExpressionAttributeValues: { ':revision': 7, ':next': 8 } })
  expect(transaction.TransactItems?.[1].Update?.ConditionExpression).toBe('attribute_exists(stopId)')
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
})

it('does not let an unsupported date field bypass overlap validation', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [
    { stopId: 'stop-1', date: '2027-04-21', time: '08:00', visitDurationMinutes: 60 },
    { stopId: 'stop-2', date: '2027-04-21', time: '10:00', visitDurationMinutes: 60, placeName: 'Museum' },
  ] })
  await expect(updateStop('trip-1', 'stop-1', { time: '10:00', date: '2027-04-22' } as never, ddbMock as unknown as DynamoDBDocumentClient)).rejects.toThrow('overlaps')
  expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0)
})


it('geocodes an edited address and saves its coordinates atomically', async () => {
  placesMock.on(GeocodeCommand).resolves({ ResultItems: [{ PlaceId: 'paris', PlaceType: 'PointAddress', Title: 'Paris', Position: [2.29, 48.85] }] })
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} })
  await updateStop('trip-1', 'stop-1', { address: ' Paris ' }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)
  expect(lastStopUpdate().ExpressionAttributeValues).toMatchObject({ ':address': 'Paris', ':location': { lat: 48.85, lng: 2.29 } })
  expect(placesMock.commandCalls(GeocodeCommand)[0].args[0].input.QueryText).toBe('Paris')
})

it('removes obsolete coordinates when the new address has no match', async () => {
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} })
  await updateStop('trip-1', 'stop-1', { address: 'Unknown address' }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)
  expect(lastStopUpdate().UpdateExpression).toContain('REMOVE #location')
})

it('does not save an address when geocoding fails', async () => {
  placesMock.on(GeocodeCommand).rejects(new Error('Unavailable'))
  await expect(updateStop('trip-1', 'stop-1', { address: 'Paris' }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)).rejects.toThrow('Unavailable')
  expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
})


it('keeps a replacement place pin when its address is unchanged', async () => {
  placesMock.on(GetPlaceCommand).resolves({ PlaceId: 'paris', Title: 'Eiffel Tower', Address: { Label: 'Paris' }, Position: [2.29, 48.85] })
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} })
  await updateStop('trip-1', 'stop-1', { placeId: 'paris', address: ' Paris ' }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)
  expect(lastStopUpdate().ExpressionAttributeValues).toMatchObject({ ':location': { lat: 48.85, lng: 2.29 } })
  expect(placesMock.commandCalls(GeocodeCommand)).toHaveLength(0)
})

it.each(['', '   '])('clears coordinates even when a replacement place was selected with address %j', async (address) => {
  placesMock.on(GetPlaceCommand).resolves({ PlaceId: 'paris', Title: 'Eiffel Tower', Position: [2.29, 48.85] })
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} })
  await updateStop('trip-1', 'stop-1', { placeId: 'paris', address }, ddbMock as unknown as DynamoDBDocumentClient, placesMock as unknown as GeoPlacesClient)
  expect(lastStopUpdate().UpdateExpression).toContain('#location')
  expect(lastStopUpdate().ExpressionAttributeValues).not.toHaveProperty(':location')
  expect(placesMock.commandCalls(GeocodeCommand)).toHaveLength(0)
})
