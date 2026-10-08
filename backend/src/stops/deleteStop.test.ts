import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { deleteStop } from './deleteStop.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('deleteStop', () => {
  it('deletes the stop by its exact key', async () => {
    ddbMock.on(DeleteCommand).resolves({})

    await deleteStop('trip-1', 'stop-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1)
    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({
      tripId: 'trip-1',
      stopId: 'stop-1',
    })
  })
})
