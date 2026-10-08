import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { getUser } from './getUser.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('getUser', () => {
  it('returns the user profile when it exists', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'user-1', email: 'kai@example.com', displayName: 'Kai', createdAt: 'x' },
    })

    const user = await getUser('user-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(user?.email).toBe('kai@example.com')
    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({ userId: 'user-1' })
  })

  it('returns undefined when the user does not exist', async () => {
    ddbMock.on(GetCommand).resolves({})

    const user = await getUser('missing-user', ddbMock as unknown as DynamoDBDocumentClient)

    expect(user).toBeUndefined()
  })

  it('reads with strong consistency so a just-created profile is never missing from this fallback read', async () => {
    ddbMock.on(GetCommand).resolves({})

    await getUser('user-1', ddbMock as unknown as DynamoDBDocumentClient)

    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.ConsistentRead).toBe(true)
  })
})
