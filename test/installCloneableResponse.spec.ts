import { describe, expect, it, vi } from 'vitest'
import { installCloneableResponse } from '../src/lib/installCloneableResponse'
import { withoutNativeResponseClone } from './helpers'

describe('installCloneableResponse', () => {
    withoutNativeResponseClone()

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

    it('tees stream bodies so the clone gets every byte', async () => {
        installCloneableResponse()

        const response = new Response(chunks('<html>', '<body>ok</body>', '</html>'), {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
        })
        const cloned = response.clone()

        expect(cloned.headers.get('Content-Type')).toBe('text/html')
        expect(await response.text()).toBe('<html><body>ok</body></html>')
        expect(await cloned.text()).toBe('<html><body>ok</body></html>')
    })

    it('keeps a stream body and its clone() when rewrapped in a new Response', async () => {
        installCloneableResponse()

        const response = new Response(chunks('a', 'b'))
        const rewrapped = new Response(response.body, { headers: { 'Set-Cookie': 'x=1' } })

        expect(rewrapped.body).toBe(response.body)
        const cloned = rewrapped.clone()
        expect(await rewrapped.text()).toBe('ab')
        expect(await cloned.text()).toBe('ab')
    })

    it('does not start the source until the body is read', async () => {
        installCloneableResponse()

        let pulls = 0
        const source = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls++
                controller.enqueue(new TextEncoder().encode('x'))
                controller.close()
            },
        }, { highWaterMark: 0 })
        const response = new Response(source)
        await Promise.resolve()

        expect(pulls).toBe(0)
        expect(await response.text()).toBe('x')
    })

    it('throws from clone() once a stream body has been read', async () => {
        installCloneableResponse()

        const response = new Response(chunks('a', 'b'))
        const reader = response.body!.getReader()
        await reader.read()

        expect(() => response.clone()).toThrow(TypeError)
    })

    it('cancels the source only once the body and every clone are cancelled', async () => {
        installCloneableResponse()

        const cancelled = vi.fn()
        const source = new ReadableStream<Uint8Array>({ cancel: cancelled })
        const response = new Response(source)
        const cloned = response.clone()

        // A tee branch's cancel settles only once its sibling is cancelled too
        const clonedCancel = cloned.body!.cancel()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(cancelled).not.toHaveBeenCalled()

        await Promise.all([response.body!.cancel(), clonedCancel])
        expect(cancelled).toHaveBeenCalledOnce()
    })
})

function chunks(...parts: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const part of parts) controller.enqueue(encoder.encode(part))
            controller.close()
        },
    })
}
