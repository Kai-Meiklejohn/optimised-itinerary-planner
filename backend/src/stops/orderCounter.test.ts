import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { getNextOrder, isOrderCounterRow } from './orderCounter.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('isOrderCounterRow', () => {
  it('identifies counter rows by their stopId prefix', () => {
    expect(isOrderCounterRow('#order#2027-04-21')).toBe(true)
    expect(isOrderCounterRow('#order#undated')).toBe(true)
    expect(isOrderCounterRow('a1b2c3-real-stop-id')).toBe(false)
  })
})

describe('getNextOrder', () => {
  it('atomically increments a per-day counter via a single conditional-free ADD', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })

    const order = await getNextOrder('trip-1', '2027-04-21', ddbMock as unknown as DynamoDBDocumentClient)

    expect(order).toBe(1000)
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input
    expect(call.Key).toEqual({ tripId: 'trip-1', stopId: '#order#2027-04-21' })
    expect(call.UpdateExpression).toBe('ADD orderCounter :step')
  })

  it('keys undated stops separately from any specific date', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 1 } })

    await getNextOrder('trip-1', undefined, ddbMock as unknown as DynamoDBDocumentClient)

    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input
    expect(call.Key).toEqual({ tripId: 'trip-1', stopId: '#order#undated' })
  })

  it('scales the returned counter by the order step', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { orderCounter: 5 } })

    const order = await getNextOrder('trip-1', '2027-04-21', ddbMock as unknown as DynamoDBDocumentClient)

    expect(order).toBe(5000)
  })
})
