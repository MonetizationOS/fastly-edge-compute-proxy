import { deflateSync, gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { acceptsGzip, normalizeOriginResponse, originFetcher } from '../src/fastlyOriginFetcher'

const encoder = new TextEncoder()

describe('normalizeOriginResponse', () => {
    it('passes non-HTML responses through unread', async () => {
        const origin = new Response('{"ok":true}', {
            headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': '11' },
        })

        const normalized = await normalizeOriginResponse(origin)

        expect(normalized).toBe(origin)
        expect(origin.bodyUsed).toBe(false)
    })

    it('returns HTML before the origin finishes sending it', async () => {
        const origin = controlledStream()
        origin.push('<html><head><meta name="a" content="b"></head><body>')

        const normalized = await normalizeOriginResponse(htmlResponse(origin.stream, { 'Content-Length': '999' }))
        const reader = normalized.body!.getReader()
        const first = await reader.read()

        expect(new TextDecoder().decode(first.value)).toBe('<html><head><meta name="a" content="b"></head><body>')
        expect(normalized.headers.get('Content-Length')).toBe('999')

        origin.push('<p>late</p></body></html>')
        origin.close()
        expect(await readAll(reader)).toBe('<p>late</p></body></html>')
    })

    it('streams a gzip body decoded and drops the encoding headers', async () => {
        const html = '<html><head></head><body><p>gzipped</p></body></html>'
        const gzipped = gzipSync(html)
        const origin = controlledStream()
        origin.pushBytes(gzipped.subarray(0, 10))

        const normalized = await normalizeOriginResponse(
            htmlResponse(origin.stream, { 'Content-Encoding': 'gzip', 'Content-Length': String(gzipped.length) }),
        )
        origin.pushBytes(gzipped.subarray(10))
        origin.close()

        expect(normalized.headers.get('Content-Encoding')).toBeNull()
        expect(normalized.headers.get('Content-Length')).toBeNull()
        expect(await normalized.text()).toBe(html)
    })

    it('matches the HTML content type case-insensitively', async () => {
        const html = '<html><body>mixed case</body></html>'

        const normalized = await normalizeOriginResponse(
            htmlResponse(new Response(gzipSync(html)).body!, {
                'Content-Type': 'Text/HTML; charset=UTF-8',
                'Content-Encoding': 'gzip',
            }),
        )

        expect(normalized.headers.get('Content-Encoding')).toBeNull()
        expect(await normalized.text()).toBe(html)
    })

    it('asks Fastly to compress decoded HTML but not HTML it left encoded', async () => {
        const decoded = await normalizeOriginResponse(
            htmlResponse(new Response(gzipSync('<p>a</p>')).body!, { 'Content-Encoding': 'gzip' }),
        )
        const encoded = await normalizeOriginResponse(htmlResponse(new Response('x').body!, { 'Content-Encoding': 'br' }))

        expect(decoded.headers.get('x-compress-hint')).toBe('on')
        expect(encoded.headers.get('x-compress-hint')).toBeNull()
    })

    it('sniffs gzip without Content-Encoding, even split after the first byte', async () => {
        const html = '<html><body>sniffed</body></html>'
        const gzipped = gzipSync(html)
        const origin = controlledStream()
        origin.pushBytes(gzipped.subarray(0, 1))
        origin.pushBytes(gzipped.subarray(1))
        origin.close()

        const normalized = await normalizeOriginResponse(htmlResponse(origin.stream))

        expect(await normalized.text()).toBe(html)
    })

    it('decodes deflate bodies', async () => {
        const html = '<html><body>deflated</body></html>'

        const normalized = await normalizeOriginResponse(
            htmlResponse(new Response(deflateSync(html)).body!, { 'Content-Encoding': 'deflate' }),
        )

        expect(normalized.headers.get('Content-Encoding')).toBeNull()
        expect(await normalized.text()).toBe(html)
    })

    it('returns a null body for an empty HTML body', async () => {
        const origin = controlledStream()
        origin.close()

        const normalized = await normalizeOriginResponse(htmlResponse(origin.stream, { 'Content-Length': '0' }))

        expect(normalized.body).toBeNull()
        expect(normalized.headers.get('Content-Length')).toBeNull()
    })

    it('drops the encoding headers of a bodyless gzip HTML response, as GET serves it decoded', async () => {
        const origin = new Response(null, {
            headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': '123' },
        })

        const normalized = await normalizeOriginResponse(origin)

        expect(normalized.body).toBeNull()
        expect(normalized.headers.get('Content-Encoding')).toBeNull()
        expect(normalized.headers.get('Content-Length')).toBeNull()
    })

    it('cancels the origin when the normalized body is cancelled', async () => {
        const cancel = vi.fn()
        const origin = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('<html><head></head><body>'))
            },
            cancel,
        })

        const normalized = await normalizeOriginResponse(htmlResponse(origin))
        await normalized.body!.cancel('replaced')

        expect(cancel).toHaveBeenCalledWith('replaced')
    })
})

function htmlResponse(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Response {
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } })
}

function controlledStream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c
        },
    })
    return {
        stream,
        push: (text: string) => controller.enqueue(encoder.encode(text)),
        pushBytes: (bytes: Uint8Array) => controller.enqueue(new Uint8Array(bytes)),
        close: () => controller.close(),
    }
}

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = []
    for (;;) {
        const { done, value } = await reader.read()
        if (done) return new Response(new Blob(chunks)).text()
        chunks.push(value)
    }
}

describe('originFetcher', () => {
    it.each([
        ['gzip, deflate, br', 'gzip'],
        ['br;q=1.0, gzip;q=0.8', 'gzip'],
        ['*', 'gzip'],
        ['gzip;q=0, *', 'identity'],
        ['br', 'identity'],
        [null, 'identity'],
    ])('asks the origin for %s as %s', async (viewer, expected) => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { headers: { 'Content-Type': 'text/plain' } }))
        vi.stubGlobal('fetch', fetchMock)
        const headers = viewer === null ? undefined : { 'Accept-Encoding': viewer }

        await originFetcher(new Request('https://origin.example/page', { headers }))

        expect((fetchMock.mock.calls[0]![0] as Request).headers.get('Accept-Encoding')).toBe(expected)
        vi.unstubAllGlobals()
    })
})

describe('acceptsGzip', () => {
    it('reads q values and the wildcard', () => {
        expect(acceptsGzip('x-gzip')).toBe(true)
        expect(acceptsGzip('GZIP; q=0.5')).toBe(true)
        expect(acceptsGzip('*;q=0')).toBe(false)
        expect(acceptsGzip('')).toBe(false)
    })
})
