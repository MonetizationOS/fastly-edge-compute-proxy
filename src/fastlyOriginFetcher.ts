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

/**
 * Backend fetch responses on Fastly Compute are not always full WHATWG Response
 * objects (e.g. they may lack `clone()`). Re-wrap the body into a constructed
 * Response so mos-proxy can tee, clone for fail-open, and rewrite HTML.
 *
 * Uses byte buffers rather than `response.text()` so gzip-compressed or binary
 * bodies are not mis-decoded as UTF-8 (which throws at offset 0 for gzip).
 */
async function normalizeOriginResponse(response: Response): Promise<Response> {
    if (!response.body) {
        return new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        })
    }

    if (typeof (response as any).clone === 'function' && !shouldMaterializeBody(response)) {
        return response
    }

    const headers = new Headers(response.headers)
    let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer())
    bytes = await maybeDecompress(bytes, headers)

    headers.delete('Content-Length')

    return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}

function shouldMaterializeBody(response: Response): boolean {
    const contentType = response.headers.get('Content-Type') ?? ''
    return (
        contentType.startsWith('text/html') ||
        response.headers.has('Content-Encoding') ||
        typeof (response as any).clone !== 'function'
    )
}

async function maybeDecompress(bytes: Uint8Array, headers: Headers): Promise<Uint8Array> {
    const encoding = headers.get('Content-Encoding')?.toLowerCase()
    const isGzip = encoding === 'gzip' || (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)

    if (isGzip) {
        headers.delete('Content-Encoding')
        return decompressBytes(bytes, 'gzip')
    }

    if (encoding === 'deflate') {
        headers.delete('Content-Encoding')
        return decompressBytes(bytes, 'deflate')
    }

    return new Uint8Array(bytes)
}

async function decompressBytes(data: Uint8Array, format: 'gzip' | 'deflate'): Promise<Uint8Array> {
    const decompressed = new Response(data).body!.pipeThrough(new DecompressionStream(format))
    return new Uint8Array(await new Response(decompressed).arrayBuffer())
}
