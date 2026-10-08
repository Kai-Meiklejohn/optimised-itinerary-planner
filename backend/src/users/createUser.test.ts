import { beforeEach, describe, expect, it } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { createUser } from './createUser.js'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('createUser', () => {
  it('writes a new user profile with a createdAt timestamp', async () => {
    ddbMock.on(PutCommand).resolves({})

    const user = await createUser(
      { userId: 'user-1', email: 'kai@example.com', displayName: 'Kai' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(user).toEqual({
      userId: 'user-1',
      email: 'kai@example.com',
      displayName: 'Kai',
      createdAt: user.createdAt,
    })
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1)
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.ConditionExpression).toBe('attribute_not_exists(userId)')
  })

  it('rejects invalid input without calling DynamoDB', async () => {
    await expect(
      createUser({ userId: 'user-1' }, ddbMock as unknown as DynamoDBDocumentClient),
    ).rejects.toThrow('Invalid user input')

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('rejects an email or displayName that exceeds the length limit', async () => {
    await expect(
      createUser(
        { userId: 'user-1', email: `${'a'.repeat(250)}@example.com` },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid user input')

    await expect(
      createUser(
        { userId: 'user-1', email: 'kai@example.com', displayName: 'a'.repeat(101) },
        ddbMock as unknown as DynamoDBDocumentClient,
      ),
    ).rejects.toThrow('Invalid user input')

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('returns the existing profile instead of overwriting it when the user already exists', async () => {
    const conflict = new Error('conditional check failed')
    conflict.name = 'ConditionalCheckFailedException'
    ddbMock.on(PutCommand).rejects(conflict)
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'user-1', email: 'original@example.com', displayName: 'Original', createdAt: 'earlier' },
    })

    const user = await createUser(
      { userId: 'user-1', email: 'new@example.com', displayName: 'New name' },
      ddbMock as unknown as DynamoDBDocumentClient,
    )

    expect(user).toEqual({ userId: 'user-1', email: 'original@example.com', displayName: 'Original', createdAt: 'earlier' })
  })
})
