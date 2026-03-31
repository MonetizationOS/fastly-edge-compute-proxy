import type { Env } from '../types'
import transformOriginLinks from './transformOriginLinks'

export default async function rewriteOriginResponse(request: Request, env: Env, response: Response): Promise<Response> {
    const requestUrl = new URL(request.url)
    const originUrl = new URL(env.ORIGIN_URL)

    // Rewrite origin response header links
    const headers = new Headers()
    response.headers.forEach((value, name) => {
        try {
            headers.append(name, transformOriginLinks(requestUrl, originUrl, value))
        } catch (err) {
            console.error(`Error rewriting header ${name} link`, err)
            headers.append(name, value)
        }
    })
    headers.set('Cache-Control', 'no-store')
    headers.delete('Content-Length')
    headers.delete('Content-Encoding')

    // Rewrite origin response body links
    let body: string | null = null
    try {
        body = await response.text()
        if (!body?.length) {
            return new Response('', { status: response.status, statusText: response.statusText, headers })
        }

        const transformedBody = transformOriginLinks(requestUrl, originUrl, body)
        return new Response(transformedBody, { status: response.status, statusText: response.statusText, headers })
    } catch (err) {
        console.error('Error rewriting origin links', err)
        return new Response(body || '', { status: response.status, statusText: response.statusText, headers })
    }
}
