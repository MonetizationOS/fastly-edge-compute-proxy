/// <reference types="@fastly/js-compute" />
import { parsePageMetadata } from '../2-rewrite-origin-response/parsePageMetadata'
import type { Env, FastlyMetadata, SurfaceDecisionResponse } from '../types'
import fetchSurfaceDecisions from './fetchSurfaceDecisions'
import handleAuthIdentifier from './handleAuthIdentifier'

export default async function getSurfaceDecisions(
    event: FetchEvent,
    env: Env,
    response: Response,
): Promise<[Response, SurfaceDecisionResponse | null]> {
    const request = event.request
    const [modifiedResponse, authIdentifier] = handleAuthIdentifier(request, env, response)

    const [metadataStream, passThroughStream] = modifiedResponse.body?.tee() ?? [null, null]
    const pageMetadata = metadataStream
        ? await parsePageMetadata(
              new Response(metadataStream, {
                  status: modifiedResponse.status,
                  statusText: modifiedResponse.statusText,
                  headers: modifiedResponse.headers,
              }),
          )
        : {}

    const fastly = buildFastlyMetadata(event, request)

    const surfaceDecisions = await fetchSurfaceDecisions(env, {
        surfaceSlug: env.SURFACE_SLUG,
        ...authIdentifier,
        path: new URL(request.url).pathname,
        url: request.url,
        pageMetadata,
        fastly,
    })

    return [
        passThroughStream
            ? new Response(passThroughStream, {
                  status: modifiedResponse.status,
                  statusText: modifiedResponse.statusText,
                  headers: modifiedResponse.headers,
              })
            : modifiedResponse,
        surfaceDecisions,
    ]
}

function buildFastlyMetadata(event: FetchEvent, request: Request): FastlyMetadata {
    return {
        client: event.client,
        // X-SigSci-* headers are set by Fastly's Next-Gen WAF (Signal Sciences) when enabled.
        // Full signal reference: https://www.fastly.com/documentation/guides/next-gen-waf/signals/using-system-signals/
        'x-sigsci-tags-header': request.headers.get('x-sigsci-tags'),
        'x-sigsci-requestid-header': request.headers.get('x-sigsci-requestid'),
    }
}
