/// <reference types="@fastly/js-compute" />

/**
 * Fetches from the Fastly `monetization_api` backend with gzip.
 *
 * Every API request asks for gzip and Fastly decodes it, dropping Content-Encoding and Content-Length.
 * Responses relayed to the viewer (/mos-api routes, custom endpoints) carry `x-compress-hint: on`, so
 * Fastly compresses them again as the viewer's Accept-Encoding allows.
 */
export async function apiFetcher(request: Request): Promise<Response> {
    request.headers.set('Accept-Encoding', 'gzip')
    const response = await fetch(request, { backend: 'monetization_api', fastly: { decompressGzip: true } })
    response.headers.set('x-compress-hint', 'on')
    return response
}
