/// <reference types="@fastly/js-compute" />
import { MOSProxyBuilder } from '@monetizationos/proxy'
import { loadEnv } from './env'
import { buildFastlyClientMetadata } from './fastlyClientMetadata'
import { fastlyHtmlRewriter } from './fastlyHtmlRewriter'
import { originFetcher } from './fastlyOriginFetcher'
import { installCloneableResponse } from './lib/installCloneableResponse'

// mos-proxy fail-open uses response.clone(); Fastly Responses often lack it.
installCloneableResponse()

addEventListener('fetch', (event) => event.respondWith(handleRequest(event)))

export async function handleRequest(event: FetchEvent): Promise<Response> {
    const env = await loadEnv()

    const proxy = new MOSProxyBuilder()
        .withConfig({
            originUrl: env.ORIGIN_URL || 'https://example.local',
            surfaceSlug: env.SURFACE_SLUG ?? '',
            mosHost: env.MONETIZATION_OS_HOST || 'https://api.monetizationos.com',
            mosSecretKey: env.MONETIZATION_OS_SECRET_KEY ?? '',
            mosEndpointsPrefix: env.MONETIZATION_OS_ENDPOINTS_PREFIX || '/mos-endpoints/',
            anonymousSessionCookieName: env.ANONYMOUS_SESSION_COOKIE_NAME,
            authenticatedUserJwtCookieName: env.AUTHENTICATED_USER_JWT_COOKIE_NAME,
            injectScriptUrl: env.INJECT_SCRIPT_URL || undefined,
            surfaceDecisionsIgnorePaths: env.SURFACE_DECISIONS_IGNORE_PATHS,
            surfaceDecisionsCookies: env.SURFACE_DECISIONS_COOKIES,
        })
        .withOriginFetcher(originFetcher)
        .withApiFetcher((request) => fetch(request, { backend: 'monetization_api' }))
        .withHtmlRewriter(fastlyHtmlRewriter)
        .withClientMetadata({
            build(request) {
                return {
                    fastly: buildFastlyClientMetadata(event, request, env),
                }
            },
        })
        .build()

    return proxy.handle(event.request)
}
