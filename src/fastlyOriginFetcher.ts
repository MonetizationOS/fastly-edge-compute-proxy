/// <reference types="@fastly/js-compute" />

/**
 * Fetches from the Fastly `origin` backend and normalizes the response for mos-proxy.
 */
export function originFetcher(request: Request): Promise<Response> {
    const headers = new Headers(request.headers)
    headers.set('Accept-Encoding', 'identity')

    const init: RequestInit = {
        method: request.method,
        headers,
        body: request.body,
    }
    if (request.body) {
        (init as any).duplex = 'half'
    }

    return fetch(new Request(request.url, init), { backend: 'origin' }).then(normalizeOriginResponse)
}

type Encoding = 'gzip' | 'deflate'

/**
 * Streams HTML to mos-proxy decoded, so it can decide on the head while the origin is still sending.
 * Other responses pass through untouched.
 *
 * Decodes gzip/deflate even though the origin is asked for identity, sniffing gzip magic bytes for
 * origins that compress without saying so.
 */
export async function normalizeOriginResponse(response: Response): Promise<Response> {
    const contentType = response.headers.get('Content-Type') ?? ''
    if (!response.body || !contentType.startsWith('text/html')) {
        return response
    }

    const reader = response.body.getReader()
    const head = await peek(reader, 2)
    const headers = new Headers(response.headers)
    const init = { status: response.status, statusText: response.statusText, headers }
    if (!head) {
        headers.delete('Content-Length')
        return new Response(null, init)
    }

    let body = replay(head, reader)
    const encoding = detectEncoding(headers.get('Content-Encoding'), head)
    if (encoding) {
        body = body.pipeThrough(new DecompressionStream(encoding))
        headers.delete('Content-Encoding')
        headers.delete('Content-Length')
    }
    return new Response(body, init)
}

function detectEncoding(contentEncoding: string | null, head: Uint8Array): Encoding | null {
    const encoding = contentEncoding?.trim().toLowerCase()
    if (encoding === 'gzip' || encoding === 'x-gzip' || (head[0] === 0x1f && head[1] === 0x8b)) {
        return 'gzip'
    }
    return encoding === 'deflate' ? 'deflate' : null
}

/** Reads until at least `minBytes` are buffered or the body ends; null for an empty body. */
async function peek(reader: ReadableStreamDefaultReader<Uint8Array>, minBytes: number): Promise<Uint8Array | null> {
    let head: Uint8Array | null = null
    while (!head || head.byteLength < minBytes) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.byteLength) continue
        head = head ? concat(head, value) : value
    }
    return head
}

/** Re-emits the peeked bytes, then the rest of the reader; cancel reaches the origin. */
function replay(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
    let pending: Uint8Array | null = head
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (pending) {
                controller.enqueue(pending)
                pending = null
                return
            }
            const { done, value } = await reader.read()
            if (done) {
                controller.close()
            } else {
                controller.enqueue(value)
            }
        },
        cancel(reason) {
            return reader.cancel(reason)
        },
    })
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.byteLength + b.byteLength)
    out.set(a)
    out.set(b, a.byteLength)
    return out
}
