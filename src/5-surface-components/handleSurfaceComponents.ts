/// <reference types="@fastly/js-compute" />
import { HTMLRewritingStream, type Element } from 'fastly:html-rewriter'
import type { Env, SurfaceDecisionResponse, WebContentSurfaceBehavior, WebElement } from '../types'
import { renderElementForStream } from './elements'

/**
 * Apply surface component behaviors to the HTML response.
 *
 * Uses Fastly's HTMLRewritingStream which is built on the same lol-html engine
 * as Cloudflare's HTMLRewriter. This mirrors the Cloudflare ContentElementHandler
 * logic as closely as possible.
 */
export default async function handleSurfaceComponents(
    response: Response,
    surfaceDecisions: SurfaceDecisionResponse,
    env: Env,
): Promise<Response> {
    if (surfaceDecisions.componentsSkipped) {
        return response
    }

    const transformer = new HTMLRewritingStream()
    let doRewrite = false

    for (const [componentKey, componentBehavior] of Object.entries(surfaceDecisions.componentBehaviors)) {
        if (!componentBehavior.metadata?.cssSelector || !componentBehavior.content) {
            continue
        }

        if (componentBehavior.metadata.cssSelector.includes(':last-child')) {
            console.warn(`Ignoring unsupported CSS selector '${componentBehavior.metadata.cssSelector}'`)
            continue
        }

        const selector = componentBehavior.metadata.cssSelector
        const content = componentBehavior.content as WebContentSurfaceBehavior

        // Content modifications — mirrors Cloudflare's ContentElementHandler
        try {
            transformer.onElement(selector, (element) => {
                applyContentModifications(element, content)
            })
            doRewrite = true
        } catch (error) {
            console.error(
                `Error adding component transform for selector '${selector}' of component '${componentKey}'`,
                error,
            )
        }

        // Range replacements — warn if needed (requires onEndTag/text handlers not
        // available in Fastly's HTMLRewritingStream)
        if (content.replaceRange) {
            console.warn(
                `Range replacement for component '${componentKey}' (selector '${selector}') ` +
                    'is not yet supported in the Fastly worker. Skipping replaceRange.',
            )
        }
    }

    // Inject web components script into <head>
    if (env.INJECT_SCRIPT_URL) {
        transformer.onElement('head', (element) => {
            element.append(`<script src="${env.INJECT_SCRIPT_URL}" async defer></script>`, { html: true } as never)
        })
        doRewrite = true
    }

    if (!doRewrite) {
        return response
    }

    const headers = new Headers(response.headers)
    headers.delete('Content-Length')
    headers.delete('Content-Encoding')

    return new Response(response.body!.pipeThrough(transformer), {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// Content modifications — exact mirror of Cloudflare's ContentElementHandler
// ──────────────────────────────────────────────────────────────────────────────

const transformPositions = ['before', 'prepend', 'append', 'after'] as const
const reversePositions = ['after', 'prepend'] as const

type TransformPosition = (typeof transformPositions)[number]

/**
 * Apply before/prepend/append/after/remove content modifications.
 *
 * This is a direct translation of the Cloudflare ContentElementHandler:
 * 1. Apply all positional content (before, prepend, append, after)
 * 2. If content.remove is true:
 *    - If there was any content added: replaceWith('') to remove the element
 *      but preserve before/after content (same as Cloudflare's replace('', { html: true }))
 *    - If no content was added: remove() the element entirely
 *
 * Since both Cloudflare and Fastly use lol-html, before()/after() content
 * survives replaceWith('') because it's emitted outside the element boundaries.
 */
function applyContentModifications(element: Element, content: WebContentSurfaceBehavior): void {
    let retainElement = false

    for (const position of transformPositions) {
        const elements = content[position] as WebElement[] | undefined
        if (!elements?.length) continue

        const ordered = (reversePositions as readonly string[]).includes(position)
            ? [...elements].reverse()
            : elements

        for (const el of ordered) {
            const { content: c, options } = renderElementForStream(el)
            element[position as TransformPosition](c, options)
        }

        retainElement = true
    }

    if (content.remove) {
        element.replaceWith('')
    }
}
