import { ValidationError } from './errors.js'

export function parseJsonBody(body: string | null | undefined): Record<string, unknown> {
  if (!body) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError('Request body must be a JSON object')
  }

  return parsed as Record<string, unknown>
}
