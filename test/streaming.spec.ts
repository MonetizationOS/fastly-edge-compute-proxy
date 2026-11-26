import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { handleRequest } from '../src/index'
import { surfaceDecisionsResponse, testEnv, withoutNativeResponseClone } from './helpers'
import { findSurfaceDecisionsCall } from './surfaceDecisionsBody'

vi.mock('../src/env', async () => {
    const { testEnv } = await import('./helpers')
    return { loadEnv: vi.fn().mockResolvedValue(testEnv) }
})

const metadata = vi.hoisted(() => ({ fail: false }))

vi.mock('../src/fastlyClientMetadata', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/fastlyClientMetadata')>()
    return {
        ...original,
        buildFastlyClientMetadata: (...args: Parameters<typeof original.buildFastlyClientMetadata>) => {
            if (metadata.fail) throw new Error('metadata failed')
            return original.buildFastlyClientMetadata(...args)
        },
    }
})

const encoder = new TextEncoder()
const head = `<html><head><meta name="title" content="Hello"></head><body>`
const rest = `<h1>Late</h1><a href="${testEnv.ORIGIN_URL}/next">next</a></body></html>`

describe('streamed HTML pipeline', () => {
    withoutNativeResponseClone()

    afterEach(() => {
        metadata.fail = false
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('asks for decisions and responds once the head arrives, before the origin finishes', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const origin = stubOrigin()
        origin.push(head)

        const res = await handleRequest({ request: new Request('https://test.example/article') } as FetchEvent)

        expect(findSurfaceDecisionsCall(origin.fetchMock)).toBeDefined()
        expect(origin.closed).toBe(false)

        origin.push(rest)
        origin.close()
        const text = await res.text()
        expect(text).toContain('<meta name="title" content="Hello">')
        expect(text).toContain('<i>BEFORE</i><h1>Late</h1>')
        expect(text).toContain('href="https://test.example/next"')
        expect(cloneFailures(warn)).toEqual([])
    })

    it('gives a bodyless HTML origin response a clone for fail-open', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation((request: Request) => {
                if (request.url.startsWith(testEnv.ORIGIN_URL)) {
                    const notModified = new Response(null, { status: 304, headers: { 'Content-Type': 'text/html' } })
                    // Like a Fastly backend response
                    delete (notModified as { clone?: unknown }).clone
                    return Promise.resolve(notModified)
                }
                return Promise.resolve(Response.json(surfaceDecisionsResponse))
            }),
        )

        const res = await handleRequest({ request: new Request('https://test.example/article') } as FetchEvent)

        expect(res.status).toBe(304)
        expect(cloneFailures(warn)).toEqual([])
    })

    it('fails open to the whole page when the pipeline throws after reading the head', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        metadata.fail = true
        const origin = stubOrigin()
        origin.push(head)
        origin.push(rest)
        origin.close()

        const res = await handleRequest({ request: new Request('https://test.example/article') } as FetchEvent)

        expect(findSurfaceDecisionsCall(origin.fetchMock)).toBeUndefined()
        expect(res.status).toBe(200)
        expect(await res.text()).toBe(`${head}<h1>Late</h1><a href="https://test.example/next">next</a></body></html>`)
    })
})

/** Stubs fetch with a streaming HTML origin the test feeds, and a surface decision that adds content before `h1`. */
function stubOrigin() {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const state = { closed: false }
    const body = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c
        },
    })
    const fetchMock = vi.fn().mockImplementation((request: Request) => {
        if (request.url.startsWith(testEnv.ORIGIN_URL)) {
            return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        }
        return Promise.resolve(
            new Response(
                JSON.stringify({
                    ...surfaceDecisionsResponse,
                    componentBehaviors: {
                        a: { metadata: { cssSelector: 'h1' }, content: { before: [{ type: 'html', content: '<i>BEFORE</i>' }] } },
                    },
                }),
                { headers: { 'Content-Type': 'application/json' } },
            ),
        )
    })
    vi.stubGlobal('fetch', fetchMock)
    return {
        fetchMock,
        get closed() {
            return state.closed
        },
        push: (text: string) => controller.enqueue(encoder.encode(text)),
        close: () => {
            state.closed = true
            controller.close()
        },
    }
}

/** The core's fail-open clone warnings; it logs `console.warn(message, { code, stage }, error)`. */
function cloneFailures(warn: MockInstance<typeof console.warn>) {
    return warn.mock.calls.filter(([, context]) => context?.code === 'response-clone-failed')
}
