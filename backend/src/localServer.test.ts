import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { server } from './localServer.js'

let baseUrl: string

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected the test server to bind to a TCP port')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(() => {
  server.close()
})

describe('localServer CORS enforcement', () => {
  it('rejects a request from an origin outside the allowlist before it reaches the mutation handler', async () => {
    const response = await fetch(`${baseUrl}/trips`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'Content-Type': 'text/plain' },
      body: 'not json',
    })

    expect(response.status).toBe(403)
  })

  it('allows a request from the allowed frontend origin through to the handler', async () => {
    const response = await fetch(`${baseUrl}/trips`, {
      method: 'GET',
      headers: { Origin: 'http://localhost:5173' },
    })

    expect(response.status).not.toBe(403)
  })

  it('allows a request with no Origin header at all (non-browser clients) through to the handler', async () => {
    const response = await fetch(`${baseUrl}/trips`, { method: 'GET' })

    expect(response.status).not.toBe(403)
  })
})
