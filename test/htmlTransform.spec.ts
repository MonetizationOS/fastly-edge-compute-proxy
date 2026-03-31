import { describe, expect, it } from 'vitest'
import handleSurfaceComponents from '../src/5-surface-components/handleSurfaceComponents'
import type { Env, SurfaceDecisionResponse, WebContentSurfaceBehavior } from '../src/types'

const componentsTag = `<script src="https://example.com/web-components-latest.js" async defer></script>`
const env: Pick<Env, 'INJECT_SCRIPT_URL'> = { INJECT_SCRIPT_URL: 'https://example.com/web-components-latest.js' }
const inputHtml = '<body><head></head><h1>Test</h1></body>'

function buildSurfaceDecisions(content: WebContentSurfaceBehavior, cssSelector = 'h1'): SurfaceDecisionResponse {
    return {
        status: 'success',
        identity: { identifier: 'id', isAuthenticated: false, authType: 'anonymous', jwtClaims: {} },
        features: {},
        customer: { hasProducts: false },
        componentsSkipped: false,
        surfaceBehavior: {},
        componentBehaviors: {
            test: { metadata: { cssSelector }, content },
        },
    }
}

async function getResultText(content: WebContentSurfaceBehavior, cssSelector?: string): Promise<string> {
    const response = new Response(inputHtml, { headers: { 'Content-Type': 'text/html' } })
    const result = await handleSurfaceComponents(response, buildSurfaceDecisions(content, cssSelector ?? 'h1'), env as Env)
    return result.text()
}

describe('MonetizationOS Proxy', () => {
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
            // Fastly/Akamai always inject INJECT_SCRIPT_URL regardless of selector validity,
            // so the script tag appears even when the component selector is skipped.
            name: ':last-child selector is ignored',
            content: { before: [{ type: 'html' as const, content: 'BEFORE' }] },
            expected: `<body><head>${componentsTag}</head><h1>Test</h1></body>`,
            cssSelector: 'h1:last-child',
        },
        {
            name: 'junk CSS selector is ignored',
            content: { before: [{ type: 'html' as const, content: 'BEFORE' }] },
            expected: `<body><head>${componentsTag}</head><h1>Test</h1></body>`,
            cssSelector: '&&&invalid###',
        },
    ])('rewrites HTML component content - $name', async ({ content, expected, cssSelector }) => {
        const text = await getResultText(content, cssSelector ?? 'h1')
        expect(text).toStrictEqual(expected)
    })
})
