/// <reference types="@fastly/js-compute" />
import { inspect } from 'fastly:security'
import type { Env } from './env'

/**
 * Builds the `fastly` object spread into the surface-decisions request body.
 */
export function buildFastlyClientMetadata(
    event: FetchEvent | undefined,
    request: Request,
    env: Pick<Env, 'NEXT_GEN_WAF_CORP' | 'NEXT_GEN_WAF_WORKSPACE'>,
): Record<string, unknown> {
    return {
        client: buildFastlyClientMetadataFromClient(event?.client),
        botManagement: buildBotManagementMetadata(request, env),
        'x-sigsci-tags-header': request.headers.get('x-sigsci-tags'),
        'x-sigsci-requestid-header': request.headers.get('x-sigsci-requestid'),
    }
}

function buildFastlyClientMetadataFromClient(client: ClientInfo | undefined): Record<string, unknown> | null {
    if (!client) {
        return null
    }

    const tlsClientCertificate = readFastlyValue(() => client.tlsClientCertificate)
    const tlsClientHello = readFastlyValue(() => client.tlsClientHello)

    return {
        requestId: readFastlyValue(() => client.requestId),
        address: readFastlyValue(() => client.address),
        geo: buildFastlyGeoMetadata(readFastlyValue(() => client.geo)),
        tlsJA3MD5: readFastlyValue(() => client.tlsJA3MD5),
        tlsJA4: readFastlyValue(() => client.tlsJA4),
        h2Fingerprint: readFastlyValue(() => client.h2Fingerprint),
        ohFingerprint: readFastlyValue(() => client.ohFingerprint),
        tlsCipherOpensslName: readFastlyValue(() => client.tlsCipherOpensslName),
        tlsProtocol: readFastlyValue(() => client.tlsProtocol),
        tlsClientCertificate: describeArrayBuffer(tlsClientCertificate),
        tlsClientHello: describeArrayBuffer(tlsClientHello),
    }
}

function buildFastlyGeoMetadata(geo: Geolocation | null): Record<string, unknown> | null {
    if (!geo) {
        return null
    }

    return {
        as_name: readFastlyValue(() => geo.as_name),
        as_number: readFastlyValue(() => geo.as_number),
        area_code: readFastlyValue(() => geo.area_code),
        city: readFastlyValue(() => geo.city),
        conn_speed: readFastlyValue(() => geo.conn_speed),
        conn_type: readFastlyValue(() => geo.conn_type),
        continent: readFastlyValue(() => geo.continent),
        country_code: readFastlyValue(() => geo.country_code),
        country_code3: readFastlyValue(() => geo.country_code3),
        country_name: readFastlyValue(() => geo.country_name),
        gmt_offset: readFastlyValue(() => geo.gmt_offset),
        latitude: readFastlyValue(() => geo.latitude),
        longitude: readFastlyValue(() => geo.longitude),
        metro_code: readFastlyValue(() => geo.metro_code),
        postal_code: readFastlyValue(() => geo.postal_code),
        proxy_description: readFastlyValue(() => geo.proxy_description),
        proxy_type: readFastlyValue(() => geo.proxy_type),
        region: readFastlyValue(() => geo.region),
        utc_offset: readFastlyValue(() => geo.utc_offset),
    }
}

/**
 * Reads a Fastly Compute host API value safely.
 *
 * Property getters on `ClientInfo`, `Geolocation`, etc. throw when the value is
 * unavailable for this request — they are not optional JS fields, so optional
 * chaining (e.g. `geo?.as_name`) does not help; the getter itself can throw.
 */
function readFastlyValue<T>(read: () => T): T | null {
    try {
        return read()
    } catch {
        return null
    }
}

function describeArrayBuffer(value: ArrayBuffer | null): Record<string, unknown> | null {
    return value ? { byteLength: value.byteLength } : null
}

function buildBotManagementMetadata(
    request: Request,
    env: Pick<Env, 'NEXT_GEN_WAF_CORP' | 'NEXT_GEN_WAF_WORKSPACE'>,
): Record<string, unknown> | null {
    if (!env.NEXT_GEN_WAF_CORP || !env.NEXT_GEN_WAF_WORKSPACE) {
        return null
    }

    try {
        const result = inspect(request, {
            corp: env.NEXT_GEN_WAF_CORP,
            workspace: env.NEXT_GEN_WAF_WORKSPACE,
        })

        return {
            wafResponse: result.waf_response,
            redirectUrl: result.redirect_url ?? null,
            tags: result.tags,
            verdict: result.verdict,
            decisionMs: result.decision_ms,
        }
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
