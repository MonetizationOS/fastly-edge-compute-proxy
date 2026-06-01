import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleRequest } from '../src/index'
import { mockFetch, surfaceDecisionsResponse } from './helpers'

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
        NEXT_GEN_WAF_CORP: 'test-corp',
        NEXT_GEN_WAF_WORKSPACE: 'test-workspace',
    }),
}))

// Fastly's HTMLRewritingStream does not expose onEndTag/text handlers, so replaceRange
// is skipped by the shared mos-proxy core when the adapter reports onEndTag: false.
describe('MonetizationOS Proxy', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.clearAllMocks()
    })

    const componentsTag = `<script src="https://example.com/web-components-latest.js" async defer></script>`

    it('skips replaceRange when the HTML rewriter lacks onEndTag support', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        mockFetch({
            responseBody: '<html><head></head><body><p>First text <h2>SubTitle</h2></p></body></html>',
            surfaceDecisions: {
                ...surfaceDecisionsResponse,
                componentBehaviors: {
                    test: {
                        metadata: { cssSelector: 'p' },
                        content: { replaceRange: { replaceWith: [{ type: 'text', content: 'REPLACEMENT' }] } },
                    },
                },
            },
        })

        const res = await handleRequest({ request: new Request('https://test.example/index.html') } as FetchEvent)
        const text = await res.text()

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Range replacement skipped'),
            expect.anything(),
        )
        expect(text).toContain('First text')
        expect(text).not.toContain('REPLACEMENT')

        consoleSpy.mockRestore()
    })

    it('applies other content mods on the same element while skipping replaceRange', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        mockFetch({
            surfaceDecisions: {
                ...surfaceDecisionsResponse,
                componentBehaviors: {
                    test: {
                        metadata: { cssSelector: 'h1' },
                        content: {
                            before: [{ type: 'html', content: 'BEFORE' }],
                            replaceRange: { replaceWith: [{ type: 'text', content: 'REPLACEMENT' }] },
                        },
                    },
                },
            },
        })

        const res = await handleRequest({ request: new Request('https://test.example/index.html') } as FetchEvent)
        const text = await res.text()

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Range replacement skipped'),
            expect.anything(),
        )
        expect(text).toBe(`<body><head>${componentsTag}</head>BEFORE<h1>Test</h1></body>`)
        expect(text).not.toContain('REPLACEMENT')

        consoleSpy.mockRestore()
    })
})
