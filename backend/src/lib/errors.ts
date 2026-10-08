export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}
