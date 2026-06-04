/// <reference types="@fastly/js-compute" />
import { HTMLRewritingStream, type Element as FastlyElement } from 'fastly:html-rewriter'
import type {
    ContentOptions,
    ElementHandlers,
    HtmlRewriterAdapter,
    HtmlRewriterSession,
    RewriterElement,
} from '@monetizationos/proxy'

export const fastlyHtmlRewriter: HtmlRewriterAdapter = {
    capabilities: { onEndTag: false, nthChild: false },
    create(): HtmlRewriterSession {
        return new FastlyHtmlRewriterSession()
    },
}

class FastlyHtmlRewriterSession implements HtmlRewriterSession {
    private readonly stream = new HTMLRewritingStream()

    on(selector: string, handlers: ElementHandlers): HtmlRewriterSession {
        if (handlers.element) {
            this.stream.onElement(selector, (element) => {
                handlers.element!(adaptElement(element))
            })
        }
        return this
    }

    transform(response: Response): Response {
        const headers = new Headers(response.headers)
        headers.delete('Content-Length')
        headers.delete('Content-Encoding')

        if (!response.body) {
            return new Response(null, {
                status: response.status,
                statusText: response.statusText,
                headers,
            })
        }

        return new Response(response.body.pipeThrough(this.stream), {
            status: response.status,
            statusText: response.statusText,
            headers,
        })
    }
}

function adaptElement(element: FastlyElement): RewriterElement {
    const toFastlyOptions = (options?: ContentOptions) => (options?.html === false ? { escapeHTML: true } : {})

    return {
        get removed() {
            return false
        },
        get tagName() {
            return ''
        },
        getAttribute: (name) => element.getAttribute(name),
        hasAttribute: (name) => element.getAttribute(name) !== null,
        setAttribute: (name, value) => {
            element.setAttribute(name, value)
        },
        removeAttribute: (name) => {
            element.removeAttribute(name)
        },
        before: (content, options) => element.before(content, toFastlyOptions(options)),
        after: (content, options) => element.after(content, toFastlyOptions(options)),
        prepend: (content, options) => element.prepend(content, toFastlyOptions(options)),
        append: (content, options) => element.append(content, toFastlyOptions(options)),
        replace: (content, options) => {
            element.replaceWith(content, toFastlyOptions(options))
        },
        remove: () => element.replaceWith(''),
    }
}
