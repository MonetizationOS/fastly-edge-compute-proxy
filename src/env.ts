/// <reference types="@fastly/js-compute" />
import { ConfigStore } from 'fastly:config-store'
import { SecretStore } from 'fastly:secret-store'

const CONFIG_STORE_NAME = 'config'
const SECRET_STORE_NAME = 'secrets'

export type Env = {
    ORIGIN_URL: string
    SURFACE_SLUG: string
    AUTHENTICATED_USER_JWT_COOKIE_NAME: string
    ANONYMOUS_SESSION_COOKIE_NAME: string
    INJECT_SCRIPT_URL: string
    MONETIZATION_OS_HOST: string
    MONETIZATION_OS_ENDPOINTS_PREFIX: string
    MONETIZATION_OS_SECRET_KEY: string
    SURFACE_DECISIONS_IGNORE_PATHS?: string
    SURFACE_DECISIONS_COOKIES?: string
    NEXT_GEN_WAF_CORP?: string
    NEXT_GEN_WAF_WORKSPACE?: string
}

/**
 * Load environment configuration from Fastly Config Store and Secret Store.
 *
 * Requires:
 * - A Config Store named per CONFIG_STORE_NAME with the application settings
 * - A Secret Store named per SECRET_STORE_NAME with the secret key
 *
 * Note: Secret store data in fastly.toml uses base64 encoding.
 * SecretStoreEntry.plaintext() returns the raw base64 string,
 * so we decode it here.
 */
export async function loadEnv(): Promise<Env> {
    const config = new ConfigStore(CONFIG_STORE_NAME)
    const secrets = new SecretStore(SECRET_STORE_NAME)
    const secretKeyEntry = await secrets.get('MONETIZATION_OS_SECRET_KEY')
    const secretKeyRaw = secretKeyEntry ? secretKeyEntry.plaintext() : ''
    const secretKey = secretKeyRaw ? atob(secretKeyRaw) : ''

    return {
        ORIGIN_URL: config.get('ORIGIN_URL') || '',
        SURFACE_SLUG: config.get('SURFACE_SLUG') || '',
        AUTHENTICATED_USER_JWT_COOKIE_NAME: config.get('AUTHENTICATED_USER_JWT_COOKIE_NAME') || '',
        ANONYMOUS_SESSION_COOKIE_NAME: config.get('ANONYMOUS_SESSION_COOKIE_NAME') || '',
        INJECT_SCRIPT_URL: config.get('INJECT_SCRIPT_URL') || '',
        MONETIZATION_OS_HOST: config.get('MONETIZATION_OS_HOST') || 'https://api.monetizationos.com',
        MONETIZATION_OS_ENDPOINTS_PREFIX: config.get('MONETIZATION_OS_ENDPOINTS_PREFIX') || '/mos-endpoints/',
        MONETIZATION_OS_SECRET_KEY: secretKey,
        SURFACE_DECISIONS_IGNORE_PATHS: config.get('SURFACE_DECISIONS_IGNORE_PATHS') || '',
        SURFACE_DECISIONS_COOKIES: config.get('SURFACE_DECISIONS_COOKIES') || '',
        NEXT_GEN_WAF_CORP: config.get('NEXT_GEN_WAF_CORP') || '',
        NEXT_GEN_WAF_WORKSPACE: config.get('NEXT_GEN_WAF_WORKSPACE') || '',
    }
}
