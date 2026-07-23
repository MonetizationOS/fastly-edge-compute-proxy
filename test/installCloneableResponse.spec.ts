import { describe, expect, it } from 'vitest'
import { installCloneableResponse } from '../src/lib/installCloneableResponse'

describe('installCloneableResponse', () => {
    it('attaches clone() for string bodies and preserves status/headers', async () => {
        installCloneableResponse()

        const response = new Response('<html>ok</html>', {
            status: 201,
            statusText: 'Created',
            headers: { 'Content-Type': 'text/html', 'X-Test': '1' },
        })

        expect(typeof response.clone).toBe('function')
        const cloned = response.clone()

        expect(cloned).not.toBe(response)
        expect(cloned.status).toBe(201)
        expect(cloned.statusText).toBe('Created')
        expect(cloned.headers.get('Content-Type')).toBe('text/html')
        expect(cloned.headers.get('X-Test')).toBe('1')
        expect(await response.text()).toBe('<html>ok</html>')
        expect(await cloned.text()).toBe('<html>ok</html>')
    })

    it('attaches clone() for Uint8Array bodies', async () => {
        installCloneableResponse()

        const bytes = new TextEncoder().encode('hello')
        const response = new Response(bytes, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
        })
        const cloned = response.clone()

        expect(await response.text()).toBe('hello')
        expect(await cloned.text()).toBe('hello')
    })

    it('supports cloning a null-body response', async () => {
        installCloneableResponse()

        const response = new Response(null, { status: 204 })
        const cloned = response.clone()

        expect(cloned.status).toBe(204)
        expect(await response.text()).toBe('')
        expect(await cloned.text()).toBe('')
    })

    it('keeps instanceof Response working', () => {
        installCloneableResponse()

        expect(new Response('x') instanceof Response).toBe(true)
    })

    it('is idempotent', async () => {
        installCloneableResponse()
        const afterFirst = globalThis.Response
        installCloneableResponse()

        expect(globalThis.Response).toBe(afterFirst)

        const response = new Response('idempotent')
        expect(await response.clone().text()).toBe('idempotent')
    })
})
