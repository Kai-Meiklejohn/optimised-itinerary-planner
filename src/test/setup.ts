import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch is disabled in tests')))
  vi.stubEnv('VITE_AWS_LOCATION_API_KEY', '')
  vi.stubEnv('VITE_AWS_ROUTES_API_KEY', '')
  vi.stubEnv('VITE_AWS_REGION', '')
  vi.stubEnv('VITE_LOCATION_MAP_NAME', '')
  vi.stubEnv('VITE_LOCATION_PLACE_INDEX_NAME', '')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', '')
  vi.stubEnv('VITE_BACKEND_API_URL', '')
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
})
