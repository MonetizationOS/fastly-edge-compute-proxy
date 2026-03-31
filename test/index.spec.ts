import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRequest } from '../src/index'
import { loadEnv } from '../src/env'
import { mockFetch, surfaceDecisionsResponse, testEnv } from './helpers'

vi.mock('../src/env', () => ({
    loadEnv: vi.fn().mockResolvedValue({
        ORIGIN_URL: 'https://origin.example',
        SURFACE_SLUG: 'web',
        AUTHENTICATED_USER_JWT_COOKIE_NAME: 'jwt-cookie',
        ANONYMOUS_SESSION_COOKIE_NAME: 'anon-session',
        INJECT_SCRIPT_URL: 'https://example.com/web-components-latest.js',
        MONETIZATION_OS_HOST: 'https://api.monetizationos.com',
        MONETIZATION_OS_ENDPOINTS_PREFIX: '/mos-endpoints/',
        MONETIZATION_OS_SECRET_KEY: 'sk_test_123_key.payload',
        SURFACE_DECISIONS_IGNORE_PATHS: '',
    }),
}))

describe('MonetizationOS Proxy', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.clearAllMocks()
    })

    it('proxies GET JSON requests', async () => {
        mockFetch({
            path: '/hello/world?x=1&y=two',
            responseBody: { success: true },
        })

        const req = new Request('https://test.example/hello/world?x=1&y=two')
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(200)
        const response = await res.json()
        expect((response as { success: boolean }).success).toBe(true)
    })

    it('proxies POST requests with body', async () => {
        mockFetch({ responseBody: { success: true } })

        const req = new Request('https://test.example/api/submit', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: 'payload-123',
        })
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(200)
        const json = await res.json()
        expect((json as { success: boolean }).success).toBe(true)
    })

    it('proxies mos API requests', async () => {
        mockFetch()

        const req = new Request('https://test.example/mos-endpoints/custom-endpoint', {
            method: 'GET',
            headers: { 'content-type': 'text/plain' },
        })
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('response')
    })

    it('fetch surface decisions for HTML responses', async () => {
        mockFetch()

        const req = new Request('https://test.example/index.html')
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(200)
    })

    it('sends raw URL in http.url in surface decisions payload', async () => {
        const fetchMock = mockFetch({ path: '/index.html?test=123&test1=456' })

        const req = new Request('https://test.example/index.html?test=123&test1=456')
        await handleRequest({ request: req } as FetchEvent)

        const surfaceDecisionsCall = fetchMock.mock.calls.find(([url]) =>
            String(url).includes('/api/v1/surface-decisions'),
        )
        const body = JSON.parse(surfaceDecisionsCall![1].body as string)
        expect(body.resource.id).toBe('/index.html')
        expect(body.http).toEqual({ url: 'https://test.example/index.html?test=123&test1=456' })
    })

    it('preserves 404 origin HTTP status code for HTML responses', async () => {
        mockFetch({
            path: '/missing-page.html',
            status: 404,
            responseBody: '<html><body>Not Found</body></html>',
        })

        const req = new Request('https://test.example/missing-page.html')
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(404)
    })

    it('does not duplicate anonymous cookie if origin already sets it', async () => {
        const originSetCookieValue = `${testEnv.ANONYMOUS_SESSION_COOKIE_NAME}=test`
        mockFetch({ responseHeaders: { 'Set-Cookie': originSetCookieValue } })

        const req = new Request('https://test.example/index.html')
        const res = await handleRequest({ request: req } as FetchEvent)
        const setCookies: string[] = []
        res.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'set-cookie') setCookies.push(value)
        })
        expect(setCookies.length).toBe(1)
        expect(setCookies[0]).toBe(originSetCookieValue)
    })

    it('rewrites origin header links', async () => {
        mockFetch({ responseHeaders: { Location: 'https://origin.example/redirect' } })

        const req = new Request('https://test.example/index.html')
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(200)
        res.headers.forEach((value, name) => {
            if (name.toLowerCase() === 'location') {
                expect(value).toBe('https://test.example/redirect')
            }
        })
    })

    it.each([
        {
            name: 'absolute https links',
            body: '<body><a href="https://origin.example/a">A</a></body>',
            includes: ['https://test.example/a'],
            excludes: ['https://origin.example/a'],
        },
        {
            name: 'absolute http links',
            body: '<body><img src="http://origin.example/img.png"></body>',
            includes: ['https://test.example/img.png'],
            excludes: ['http://origin.example/img.png'],
        },
        {
            name: 'protocol-relative links',
            body: '<body><link rel="stylesheet" href="//origin.example/styles.css"></body>',
            includes: ['https://test.example/styles.css'],
            excludes: ['//origin.example/styles.css'],
        },
        {
            name: 'multiple occurrences and other domains untouched',
            body: `<body>
                <a href="https://origin.example/x">X</a>
                <a href="//origin.example/x2">X2</a>
                <a href="https://other.example/y">Y</a>
                </body>`,
            includes: ['https://test.example/x', 'https://test.example/x2', 'https://other.example/y'],
            excludes: ['https://origin.example/x', '//origin.example/x2'],
        },
    ])('rewrites origin body links - $name', async ({ body, includes, excludes }) => {
        mockFetch({ responseBody: body })

        const req = new Request('https://test.example/index.html')
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(200)
        const text = await res.text()
        includes.forEach((s) => expect(text).toContain(s))
        excludes.forEach((s) => expect(text).not.toContain(s))
    })

    it.each([
        {
            name: 'body string',
            http: { body: 'DENIED' },
            assert: async (res: Response) => {
                expect(res.status).toBe(200)
                expect(await res.text()).toBe('DENIED')
            },
        },
        {
            name: 'body null',
            http: { body: null },
            assert: async (res: Response) => {
                expect(res.status).toBe(200)
                expect(await res.text()).toBe('')
            },
        },
        {
            name: 'set headers + cookies + status + statusText (replace)',
            http: {
                headers: { 'Content-Type': 'text/plain', 'X-Custom': '123' },
                cookies: ['session=123; Path=/', 'delicious=cookies; Path=/'],
                status: 201,
                statusText: 'Updated',
                body: 'OK',
            },
            assert: async (res: Response) => {
                expect(res.status).toBe(201)
                expect(res.statusText).toBe('Updated')
                expect(res.headers.get('content-type')).toBe('text/plain')
                expect(res.headers.get('x-custom')).toBe('123')
                const setCookies: string[] = []
                res.headers.forEach((v, k) => {
                    if (k.toLowerCase() === 'set-cookie') setCookies.push(v)
                })
                expect(setCookies).toContain('session=123; Path=/')
                expect(setCookies).toContain('delicious=cookies; Path=/')
                expect(await res.text()).toBe('OK')
            },
        },
        {
            name: 'addHeaders (modify)',
            http: { addHeaders: [{ name: 'X-Added', value: '42' }] },
            assert: async (res: Response) => {
                expect(res.headers.get('x-added')).toBe('42')
                expect(res.headers.get('content-type')).toBe('text/html')
                expect(res.status).toBe(200)
                expect(await res.text()).toContain('<h1>Test</h1>')
            },
        },
        {
            name: 'removeHeaders (modify)',
            http: { removeHeaders: ['Content-Type'] },
            assert: async (res: Response) => {
                expect(res.headers.get('content-type')).toBeNull()
                expect(res.status).toBe(200)
                expect(await res.text()).toContain('<h1>Test</h1>')
            },
        },
        {
            name: 'addCookies (modify)',
            http: { addCookies: ['c=3; Path=/', 'd=4; Path=/'] },
            assert: async (res: Response) => {
                const setCookies: string[] = []
                res.headers.forEach((v, k) => {
                    if (k.toLowerCase() === 'set-cookie') setCookies.push(v)
                })
                expect(setCookies).toContain('c=3; Path=/')
                expect(setCookies).toContain('d=4; Path=/')
                expect(res.status).toBe(200)
                expect(await res.text()).toContain('<h1>Test</h1>')
            },
        },
        {
            name: 'status and statusText (modify)',
            http: { status: 418, statusText: "I'm a teapot" },
            assert: async (res: Response) => {
                expect(res.status).toBe(418)
                expect(res.statusText).toBe("I'm a teapot")
                expect(await res.text()).toContain('<h1>Test</h1>')
            },
        },
    ])('applies surfaceBehavior http modifications - $name', async ({ http, assert }) => {
        mockFetch({
            surfaceDecisions: {
                ...surfaceDecisionsResponse,
                surfaceBehavior: { http },
                componentsSkipped: 'body' in http && http.body !== undefined,
            },
        })

        const req = new Request('https://test.example/index.html')
        const res = await handleRequest({ request: req } as FetchEvent)
        await assert(res)
    })

    it.each([301, 302, 307])('skips surface decisions for %i redirects', async (status) => {
        const fetchMock = mockFetch({
            status,
            responseHeaders: { Location: 'https://origin.example/somewhere-else' },
        })

        const req = new Request('https://test.example/redirect-page')
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(status)
        expect(res.headers.get('location')).toBe('https://test.example/somewhere-else')

        const surfaceDecisionsCalled = fetchMock.mock.calls.some(([urlOrReq]) => {
            const url = urlOrReq instanceof Request ? urlOrReq.url : String(urlOrReq)
            return url.includes('/api/v1/surface-decisions')
        })
        expect(surfaceDecisionsCalled).toBe(false)
    })

    it('skips surface decisions for ignored paths but still proxies and rewrites', async () => {
        vi.mocked(loadEnv).mockResolvedValueOnce({
            ...testEnv,
            SURFACE_DECISIONS_IGNORE_PATHS: '^/ignored/',
        })

        const fetchMock = mockFetch({
            path: '/ignored/page.html',
            responseBody: '<body><a href="https://origin.example/link">Link</a></body>',
        })

        const req = new Request('https://test.example/ignored/page.html')
        const res = await handleRequest({ request: req } as FetchEvent)
        expect(res.status).toBe(200)
        const text = await res.text()
        expect(text).toContain('https://test.example/link')
        expect(text).not.toContain('https://origin.example/link')

        const surfaceDecisionsCalled = fetchMock.mock.calls.some(([urlOrReq]) => {
            const url = urlOrReq instanceof Request ? urlOrReq.url : String(urlOrReq)
            return url.includes('/api/v1/surface-decisions')
        })
        expect(surfaceDecisionsCalled).toBe(false)
    })
})
