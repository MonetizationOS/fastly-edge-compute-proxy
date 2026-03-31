import { describe, expect, it, vi } from 'vitest'
import handleSurfaceComponents from '../src/5-surface-components/handleSurfaceComponents'
import type { Env, SurfaceDecisionResponse } from '../src/types'

// Fastly's HTMLRewritingStream does not expose the onEndTag / text handler APIs
// needed for range replacement. When replaceRange is present in a component behavior,
// the worker logs a warning and skips the range replacement — content modifications
// (before/after/etc.) on the same element still apply normally.
describe('MonetizationOS Proxy', () => {
    const env: Pick<Env, 'INJECT_SCRIPT_URL'> = { INJECT_SCRIPT_URL: 'https://example.com/web-components-latest.js' }
    const componentsTag = `<script src="https://example.com/web-components-latest.js" async defer></script>`

    it('skips replaceRange and logs a warning', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const html = '<html><head></head><body><p>First text <h2>SubTitle</h2></p></body></html>'
        const response = new Response(html, { headers: { 'Content-Type': 'text/html' } })
        const surfaceDecisions: SurfaceDecisionResponse = {
            status: 'success',
            identity: { identifier: 'id', isAuthenticated: false, authType: 'anonymous', jwtClaims: {} },
            features: {},
            customer: { hasProducts: false },
            componentsSkipped: false,
            surfaceBehavior: {},
            componentBehaviors: {
                test: {
                    metadata: { cssSelector: 'p' },
                    content: { replaceRange: { replaceWith: [{ type: 'text', content: 'REPLACEMENT' }] } },
                },
            },
        }

        const result = await handleSurfaceComponents(response, surfaceDecisions, env as Env)
        const text = await result.text()

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('replaceRange'))
        expect(text).toContain('First text')
        expect(text).not.toContain('REPLACEMENT')

        consoleSpy.mockRestore()
    })

    it('applies other content mods on the same element while skipping replaceRange', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const html = '<body><head></head><h1>Test</h1></body>'
        const response = new Response(html, { headers: { 'Content-Type': 'text/html' } })
        const surfaceDecisions: SurfaceDecisionResponse = {
            status: 'success',
            identity: { identifier: 'id', isAuthenticated: false, authType: 'anonymous', jwtClaims: {} },
            features: {},
            customer: { hasProducts: false },
            componentsSkipped: false,
            surfaceBehavior: {},
            componentBehaviors: {
                test: {
                    metadata: { cssSelector: 'h1' },
                    content: {
                        before: [{ type: 'html', content: 'BEFORE' }],
                        replaceRange: { replaceWith: [{ type: 'text', content: 'REPLACEMENT' }] },
                    },
                },
            },
        }

        const result = await handleSurfaceComponents(response, surfaceDecisions, env as Env)
        const text = await result.text()

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('replaceRange'))
        // before modification IS applied even though replaceRange is skipped
        expect(text).toBe(`<body><head>${componentsTag}</head>BEFORE<h1>Test</h1></body>`)
        expect(text).not.toContain('REPLACEMENT')

        consoleSpy.mockRestore()
    })
})
