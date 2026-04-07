/// <reference types="@fastly/js-compute" />
import type { Env, FastlyMetadata, PageMetadata, SurfaceDecisionError, SurfaceDecisionResponse } from '../types'

type FetchSurfaceDecisionsArgs = {
    surfaceSlug: string
    anonymousIdentifier?: string
    userJwt?: string
    path: string
    url: string
    pageMetadata?: PageMetadata
    fastly?: FastlyMetadata
    userAgent?: string | undefined
    originStatus: number
}

/**
 * Fetch surface decisions from the MonetizationOS API.
 * Uses Fastly backend for the outgoing request.
 * Sends Fastly client metadata (ClientInfo + raw WAF headers) in place of Cloudflare's cf object.
 */
export default async function fetchSurfaceDecisions(
    env: Env,
    { surfaceSlug, anonymousIdentifier, userJwt, path, url, pageMetadata, fastly, userAgent, originStatus }: FetchSurfaceDecisionsArgs,
): Promise<SurfaceDecisionResponse | null> {
    if (!env.MONETIZATION_OS_SECRET_KEY) {
        console.warn('MONETIZATION_OS_SECRET_KEY is not set, skipping surface decisions')
        return null
    }

    const host = env.MONETIZATION_OS_HOST || 'https://api.monetizationos.com'

    try {
        const response = await fetch(`${host}/api/v1/surface-decisions`, {
            method: 'POST',
            body: JSON.stringify({
                surfaceSlug,
                identity: {
                    anonymousIdentifier,
                    userJwt,
                },
                resource: {
                    id: path,
                    meta: pageMetadata,
                },
                http: {
                    url,
                    userAgent,
                    proxyOrigin: {
                        status: originStatus,
                    },
                },
                fastly,
            }),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.MONETIZATION_OS_SECRET_KEY}`,
            },
            backend: 'monetization_api',
        })

        const data = (await response.json()) as SurfaceDecisionResponse | SurfaceDecisionError
        if (data.status === 'error') {
            throw new Error(data.message)
        }
        return data
    } catch (error) {
        console.error('Error fetching surface decisions:', error)
        return null
    }
}
