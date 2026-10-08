import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { handler as tripsHandler } from './handlers/trips.js'
import { handler as stopsHandler } from './handlers/stops.js'
import { handler as usersHandler } from './handlers/users.js'

const PORT = 3001
const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 1_000_000
const ALLOWED_ORIGINS = new Set(['http://localhost:5173'])

export const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Origin not allowed' }))
      return
    }
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    totalBytes += (chunk as Buffer).length
    if (totalBytes > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Request body too large' }))
      return
    }
    chunks.push(chunk as Buffer)
  }
  const body = Buffer.concat(chunks).toString('utf-8')

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const queryStringParameters = Object.fromEntries(url.searchParams)

  try {
    const event = {
      httpMethod: req.method ?? 'GET',
      path: url.pathname,
      queryStringParameters,
      headers: req.headers as Record<string, string | undefined>,
      body: body || undefined,
    }

    const result = /\/stops(\/|$)/.test(url.pathname)
      ? await stopsHandler(event)
      : url.pathname === '/users'
        ? await usersHandler(event)
        : await tripsHandler(event)

    res.writeHead(result.statusCode, result.headers)
    res.end(result.body)
  } catch (error) {
    console.error(error)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'Unexpected server error' }))
  }
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, HOST, () => {
    console.log(`Local API server listening on http://${HOST}:${PORT}`)
  })
}
