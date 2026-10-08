import { handler as tripsHandler } from './handlers/trips.js'
import { handler as stopsHandler } from './handlers/stops.js'
import { handler as usersHandler } from './handlers/users.js'

// Two request shapes reach this Lambda. apigateway.tf's AWS_PROXY (payload
// format 2.0) event: rawPath/requestContext.http, JWT already verified by
// the Cognito authorizer. alb.tf's ALB target-group invocation event: path/
// httpMethod at the top level, requestContext.elb instead of .authorizer -
// frontend.tf's CloudFront "/api/*" behavior forwards the path unchanged, so
// it still carries the "/api" prefix that gets stripped below.
type ApiGatewayV2Event = {
  rawPath: string
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string> | null
  requestContext: {
    http?: { method: string }
    authorizer?: { jwt?: { claims?: Record<string, string | undefined> } }
  }
  body?: string | null
  isBase64Encoded?: boolean
}

type AlbEvent = {
  path: string
  httpMethod: string
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string> | null
  requestContext: { elb: unknown }
  body?: string | null
  isBase64Encoded?: boolean
}

type LambdaEvent = ApiGatewayV2Event | AlbEvent

type LambdaResult = {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded: boolean
}

// The ALB has no built-in CORS handling (unlike apigateway.tf's
// cors_configuration, which answers preflight and injects these headers
// itself) - added here only for ALB-sourced responses. The deployed app
// calls this same-origin through CloudFront so these mostly matter for
// local dev pointed at the deployed backend, not the production browser flow.
// Mirrors apigateway.tf's cors_configuration allow-list rather than "*" -
// this path now carries real per-user data (Authorization-scoped responses),
// not a public resource any site should be able to read cross-origin.
const ALLOWED_ORIGINS = [process.env.FRONTEND_ORIGIN, 'http://localhost:5173'].filter(
  (origin): origin is string => Boolean(origin),
)

function corsHeadersFor(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  const origin = headers?.origin ?? headers?.Origin
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return {}
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    Vary: 'Origin',
  }
}

function isAlbEvent(event: LambdaEvent): event is AlbEvent {
  return 'elb' in event.requestContext
}

export async function handler(event: LambdaEvent): Promise<LambdaResult> {
  const fromAlb = isAlbEvent(event)
  const corsHeaders = fromAlb ? corsHeadersFor(event.headers) : {}

  const rawPath = fromAlb ? event.path.replace(/^\/api(?=\/|$)/, '') || '/' : event.rawPath
  const method = fromAlb ? event.httpMethod : (event.requestContext.http?.method ?? 'GET')

  // Matches alb.tf's target group health check path - answered directly so
  // it never reaches a route handler (which would 404 it) or requires auth.
  if (rawPath === '/health') {
    return { statusCode: 200, headers: corsHeaders, body: '', isBase64Encoded: false }
  }

  // API Gateway's cors_configuration (apigateway.tf) answers most preflight
  // requests itself, but the explicit "OPTIONS /{proxy+}" route has no
  // authorizer attached and proxies straight here instead - same as ALB,
  // which never runs a JWT authorizer at all.
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '', isBase64Encoded: false }
  }

  const normalizedEvent = {
    httpMethod: method,
    path: rawPath,
    queryStringParameters: event.queryStringParameters ?? undefined,
    headers: event.headers,
    body:
      event.isBase64Encoded && event.body
        ? Buffer.from(event.body, 'base64').toString('utf-8')
        : (event.body ?? undefined),
    requestContext: {
      // API Gateway: already verified by the Cognito JWT authorizer in front
      // of this route. ALB: never verifies anything - getAuthenticatedClaims
      // (lib/auth.ts) falls back to verifying the bearer token itself, same
      // path already used for local dev.
      authorizer: fromAlb ? undefined : event.requestContext.authorizer,
    },
  }

  const result = /\/stops(\/|$)/.test(rawPath)
    ? await stopsHandler(normalizedEvent)
    : rawPath === '/users'
      ? await usersHandler(normalizedEvent)
      : await tripsHandler(normalizedEvent)

  return {
    statusCode: result.statusCode,
    headers: { ...result.headers, ...corsHeaders },
    body: result.body,
    isBase64Encoded: false,
  }
}
