import { vi } from 'vitest'
import type { SurfaceDecisionResponse } from '../src/types'

export const testEnv = {
    ORIGIN_URL: 'https://origin.example',
    SURFACE_SLUG: 'web',
    AUTHENTICATED_USER_JWT_COOKIE_NAME: 'jwt-cookie',
    ANONYMOUS_SESSION_COOKIE_NAME: 'anon-session',
    INJECT_SCRIPT_URL: 'https://example.com/web-components-latest.js',
    MONETIZATION_OS_HOST: 'https://api.monetizationos.com',
    MONETIZATION_OS_ENDPOINTS_PREFIX: '/mos-endpoints/',
    MONETIZATION_OS_SECRET_KEY: 'sk_test_123_key.payload',
    SURFACE_DECISIONS_IGNORE_PATHS: '',
}

export const surfaceDecisionsResponse: SurfaceDecisionResponse = {
    status: 'success',
    identity: { identifier: 'id', isAuthenticated: false, authType: 'anonymous', jwtClaims: {} },
    features: {},
    customer: { hasProducts: false },
    surfaceBehavior: {},
    componentsSkipped: false,
    componentBehaviors: {},
}

type MockFetchOptions = {
    path?: string
    status?: number
    responseBody?: string | object | null
    contentType?: string
    responseHeaders?: Record<string, string>
    surfaceDecisions?: SurfaceDecisionResponse
}

/**
 * Stubs the global fetch with a mock that handles origin and surface decision requests.
 * Returns the vi.fn() so tests can inspect calls.
 */
export function mockFetch({
    path = '/index.html',
    status = 200,
    responseBody = '<body><head></head><h1>Test</h1></body>',
    contentType = 'text/html',
    responseHeaders = {},
    surfaceDecisions = surfaceDecisionsResponse,
}: MockFetchOptions = {}) {
    const fetchMock = vi.fn().mockImplementation((urlOrRequest: Request | string, _options?: RequestInit) => {
        const url = urlOrRequest instanceof Request ? urlOrRequest.url : String(urlOrRequest)

        if (url.startsWith('https://origin.example')) {
            const body =
                responseBody !== null && typeof responseBody === 'object'
                    ? JSON.stringify(responseBody)
                    : responseBody
            const ct =
                responseBody !== null && typeof responseBody === 'object' ? 'application/json' : contentType
            return Promise.resolve(
                new Response(body as string, {
                    status,
                    headers: { 'Content-Type': ct, ...responseHeaders },
                }),
            )
        }

        if (url.includes('/api/v1/surface-decisions')) {
            return Promise.resolve(
                new Response(JSON.stringify(surfaceDecisions), {
                    headers: { 'Content-Type': 'application/json' },
                }),
            )
        }

        if (url.includes('/api/v1/envs/') && url.includes('/endpoints/')) {
            return Promise.resolve(new Response('response', { status: 200 }))
        }

        return Promise.resolve(new Response('Not Found', { status: 404 }))
    })

    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}
