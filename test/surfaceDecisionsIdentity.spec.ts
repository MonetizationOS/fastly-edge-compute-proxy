import { afterEach, describe, expect, it, vi } from 'vitest'
import fetchSurfaceDecisions from '../src/3-surface-decisions/fetchSurfaceDecisions'
import { surfaceDecisionsResponse, testEnv } from './helpers'

describe('surface decisions identity payload', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it.each([
        { anonymousIdentifier: undefined, userJwt: undefined, expectedIdentity: { createAnonymousIdentifier: true } },
        { anonymousIdentifier: 'anon-id', userJwt: undefined, expectedIdentity: { anonymousIdentifier: 'anon-id' } },
        { anonymousIdentifier: undefined, userJwt: 'user-jwt', expectedIdentity: { userJwt: 'user-jwt' } },
        { anonymousIdentifier: 'anon-id', userJwt: 'user-jwt', expectedIdentity: { userJwt: 'user-jwt' } },
    ])('sends the expected identity for %s', async ({ anonymousIdentifier, userJwt, expectedIdentity }) => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify(surfaceDecisionsResponse), {
                headers: { 'Content-Type': 'application/json' },
            }),
        )
        vi.stubGlobal('fetch', fetchMock)

        await fetchSurfaceDecisions(testEnv, {
            surfaceSlug: 'web',
            anonymousIdentifier,
            userJwt,
            path: '/index.html',
            url: 'https://test.example/index.html',
        })

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
        expect(requestBody.identity).toStrictEqual(expectedIdentity)
    })
})
