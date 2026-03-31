/// <reference types="@fastly/js-compute" />
import type { Env } from '../types'

/**
 * Handle requests to MonetizationOS custom endpoints (proxied through the worker).
 */
export default async function customEndpointRequest(request: Request, env: Env): Promise<Response | null> {
    const mosApiHost = new URL(env.MONETIZATION_OS_HOST || 'https://api.monetizationos.com')
    const prefix = env.MONETIZATION_OS_ENDPOINTS_PREFIX || '/mos-endpoints/'

    const requestUrl = new URL(request.url)
    if (requestUrl.pathname.startsWith(prefix)) {
        const target = new URL(request.url)

        target.protocol = mosApiHost.protocol
        target.host = mosApiHost.host
        target.port = mosApiHost.port
        target.pathname =
            `/api/v1/envs/${extractEnvironmentFromMosKey(env)}/endpoints/` +
            requestUrl.pathname.replace(new RegExp(`^${prefix}`), '').replace(/^\//, '')

        return await fetch(new Request(target, request), {
            backend: 'monetization_api',
        })
    }
    return null
}

function extractEnvironmentFromMosKey(env: Env): string {
    const [, environmentPrefix, environmentSuffix] = env.MONETIZATION_OS_SECRET_KEY.split('_')
    return `${environmentPrefix}_${environmentSuffix}`
}
