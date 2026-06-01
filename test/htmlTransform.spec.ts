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

const componentsTag = `<script src="https://example.com/web-components-latest.js" async defer></script>`

describe('MonetizationOS Proxy', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.clearAllMocks()
    })

    it.each([
        {
            name: 'before',
            content: { before: [{ type: 'html' as const, content: 'BEFORE' }] },
            expected: `<body><head>${componentsTag}</head>BEFORE<h1>Test</h1></body>`,
        },
        {
            name: 'before multiple',
            content: {
                before: [
                    { type: 'html' as const, content: '<p>1</p>' },
                    { type: 'html' as const, content: '<p>2</p>' },
                    { type: 'html' as const, content: '<p>3</p>' },
                ],
            },
            expected: `<body><head>${componentsTag}</head><p>1</p><p>2</p><p>3</p><h1>Test</h1></body>`,
        },
        {
            name: 'after',
            content: { after: [{ type: 'html' as const, content: 'AFTER' }] },
            expected: `<body><head>${componentsTag}</head><h1>Test</h1>AFTER</body>`,
        },
        {
            name: 'after multiple',
            content: {
                after: [
                    { type: 'html' as const, content: '<p>1</p>' },
                    { type: 'html' as const, content: '<p>2</p>' },
                    { type: 'html' as const, content: '<p>3</p>' },
                ],
            },
            expected: `<body><head>${componentsTag}</head><h1>Test</h1><p>1</p><p>2</p><p>3</p></body>`,
        },
        {
            name: 'prepend',
            content: { prepend: [{ type: 'html' as const, content: '<p>PREPEND</p>' }] },
            expected: `<body><head>${componentsTag}</head><h1><p>PREPEND</p>Test</h1></body>`,
        },
        {
            name: 'prepend multiple',
            content: {
                prepend: [
                    { type: 'html' as const, content: '<p>1</p>' },
                    { type: 'html' as const, content: '<p>2</p>' },
                    { type: 'html' as const, content: '<p>3</p>' },
                ],
            },
            expected: `<body><head>${componentsTag}</head><h1><p>1</p><p>2</p><p>3</p>Test</h1></body>`,
        },
        {
            name: 'append',
            content: { append: [{ type: 'html' as const, content: '<p>APPEND</p>' }] },
            expected: `<body><head>${componentsTag}</head><h1>Test<p>APPEND</p></h1></body>`,
        },
        {
            name: 'append multiple',
            content: {
                append: [
                    { type: 'html' as const, content: '<p>1</p>' },
                    { type: 'html' as const, content: '<p>2</p>' },
                    { type: 'html' as const, content: '<p>3</p>' },
                ],
            },
            expected: `<body><head>${componentsTag}</head><h1>Test<p>1</p><p>2</p><p>3</p></h1></body>`,
        },
        {
            name: 'remove',
            content: { remove: true },
            expected: `<body><head>${componentsTag}</head></body>`,
        },
        {
            name: 'before + after + remove',
            content: {
                before: [{ type: 'html' as const, content: 'BEFORE' }],
                after: [{ type: 'text' as const, content: 'AFTER' }],
                remove: true,
            },
            expected: `<body><head>${componentsTag}</head>BEFOREAFTER</body>`,
        },
        {
            name: 'append + after',
            content: {
                after: [{ type: 'html' as const, content: '<p>AFTER</p>' }],
                append: [{ type: 'html' as const, content: '<p>APPEND</p>' }],
            },
            expected: `<body><head>${componentsTag}</head><h1>Test<p>APPEND</p></h1><p>AFTER</p></body>`,
        },
        {
            name: 'append + prepend + remove -> removes element and ignores append',
            content: {
                remove: true,
                append: [{ type: 'html' as const, content: '<p>APPEND</p>' }],
                prepend: [{ type: 'html' as const, content: '<p>PREPEND</p>' }],
            },
            expected: `<body><head>${componentsTag}</head></body>`,
        },
        {
            name: 'ignore custom',
            content: {
                before: [{ type: 'custom' as const, content: 'UNKNOWN' }],
            },
            expected: `<body><head>${componentsTag}</head><h1>Test</h1></body>`,
        },
        {
            name: 'MOS element',
            content: {
                before: [
                    {
                        type: 'element' as const,
                        schema: 'mos:test@1.0',
                        props: {
                            prop1: 'value1',
                            prop2: true,
                        },
                    },
                ],
            },
            expected: `<body><head>${componentsTag}</head><mos-test version="1.0" props="{&quot;prop1&quot;:&quot;value1&quot;,&quot;prop2&quot;:true}"></mos-test><h1>Test</h1></body>`,
        },
        {
            name: ':last-child selector is ignored',
            content: { before: [{ type: 'html' as const, content: 'BEFORE' }] },
            expected: `<body><head></head><h1>Test</h1></body>`,
            cssSelector: 'h1:last-child',
        },
        {
            name: 'junk CSS selector is ignored',
            content: { before: [{ type: 'html' as const, content: 'BEFORE' }] },
            expected: `<body><head></head><h1>Test</h1></body>`,
            cssSelector: '&&&invalid###',
        },
    ])('rewrites HTML component content - $name', async ({ content, expected, cssSelector }) => {
        mockFetch({
            surfaceDecisions: {
                ...surfaceDecisionsResponse,
                componentBehaviors: {
                    test: {
                        metadata: { cssSelector: cssSelector ?? 'h1' },
                        content,
                    },
                },
            },
        })

        const res = await handleRequest({ request: new Request('https://test.example/index.html') } as FetchEvent)
        expect(res.status).toBe(200)
        expect(await res.text()).toStrictEqual(expected)
    })
})
