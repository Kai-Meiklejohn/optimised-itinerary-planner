import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { docClient, USER_TABLE } from '../lib/dynamo.js'
import { ValidationError } from '../lib/errors.js'
import { MAX_DISPLAY_NAME_LENGTH, MAX_EMAIL_LENGTH } from '../lib/limits.js'
import { getUser } from './getUser.js'

export type CreateUserInput = {
  userId: string
  email: string
  displayName?: string
}

export type User = CreateUserInput & {
  createdAt: string
}

export function validateCreateUserInput(input: Partial<CreateUserInput>): input is CreateUserInput {
  return (
    typeof input.userId === 'string' && input.userId.length > 0
    && typeof input.email === 'string' && input.email.length > 0 && input.email.length <= MAX_EMAIL_LENGTH
    && (input.displayName === undefined
      || (typeof input.displayName === 'string' && input.displayName.length > 0 && input.displayName.length <= MAX_DISPLAY_NAME_LENGTH))
  )
}

export async function createUser(
  input: Partial<CreateUserInput>,
  client: DynamoDBDocumentClient = docClient,
): Promise<User> {
  if (!validateCreateUserInput(input)) {
    throw new ValidationError('Invalid user input')
  }

  const user: User = {
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    createdAt: new Date().toISOString(),
  }

  try {
    await client.send(
      new PutCommand({
        TableName: USER_TABLE,
        Item: user,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    )

    return user
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      const existing = await getUser(input.userId, client)
      if (existing) {
        return existing
      }
    }

    throw error
  }
}
