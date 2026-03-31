import { ReadableStream, WritableStream } from 'node:stream/web'
import { HTMLRewriter } from 'html-rewriter-wasm'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ElementHandler = (element: FastlyElement) => void

interface FastlyElementOptions {
    escapeHTML?: boolean
    html?: boolean
}

interface FastlyElement {
    before(content: string, options?: FastlyElementOptions): void
    after(content: string, options?: FastlyElementOptions): void
    prepend(content: string, options?: FastlyElementOptions): void
    append(content: string, options?: FastlyElementOptions): void
    remove(): void
    replaceWith(content: string, options?: FastlyElementOptions): void
    getAttribute(name: string): string | null
}

/**
 * Wraps a html-rewriter-wasm element to match Fastly's HTMLRewritingStream element API:
 *
 * - Fastly defaults to HTML mode; text content requires { escapeHTML: true }.
 * - html-rewriter-wasm defaults to text mode; HTML requires { html: true }.
 *
 * This wrapper translates Fastly's { escapeHTML: true } convention to wasm's { html: true }
 * convention so that production code runs correctly in tests.
 *
 * Also polyfills `replaceWith(content)` which is not present in html-rewriter-wasm.
 */
function wrapElement(handler: ElementHandler) {
    return (element: FastlyElement) => {
        const _before = element.before.bind(element)
        const _prepend = element.prepend.bind(element)
        const _append = element.append.bind(element)
        const _after = element.after.bind(element)

        // Translate Fastly options to html-rewriter-wasm options.
        // Fastly: no options (or {}) = HTML mode; { escapeHTML: true } = text mode.
        // wasm:   no options = text mode; { html: true } = HTML mode.
        const translate =
            (origFn: (content: string, options?: FastlyElementOptions) => void) =>
            (content: string, options?: FastlyElementOptions) => {
                if (options?.escapeHTML) {
                    origFn(content) // text mode
                } else {
                    origFn(content, { html: true }) // html mode
                }
            }

        element.before = translate(_before)
        element.prepend = translate(_prepend)
        element.append = translate(_append)
        element.after = translate(_after)

        element.replaceWith = (content: string) => {
            if (content) _before(content, { html: true })
            element.remove()
        }

        handler(element)
    }
}

/**
 * Node.js-compatible HTMLRewritingStream backed by html-rewriter-wasm (lol-html).
 * Implements the same TransformStream interface as Fastly's fastly:html-rewriter module
 * so tests run against the real lol-html parsing engine.
 */
export class HTMLRewritingStream {
    #handlers: { selector: string; handler: ElementHandler }[] = []
    readable: ReadableStream
    writable: WritableStream

    constructor() {
        const handlers = this.#handlers
        const inputChunks: Uint8Array[] = []
        let outputController: ReadableStreamDefaultController<Uint8Array>

        this.readable = new ReadableStream({
            start(controller) {
                outputController = controller
            },
        })

        this.writable = new WritableStream({
            write(chunk: unknown) {
                inputChunks.push(chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk)))
            },
            async close() {
                let output = ''
                const rewriter = new HTMLRewriter((chunk: BufferSource) => {
                    output += decoder.decode(chunk)
                })
                for (const { selector, handler } of handlers) {
                    try {
                        rewriter.on(selector, { element: wrapElement(handler) as never })
                    } catch {
                        // Skip selectors that are invalid at processing time (already validated at registration)
                    }
                }
                try {
                    for (const chunk of inputChunks) {
                        await rewriter.write(chunk)
                    }
                    await rewriter.end()
                } finally {
                    rewriter.free()
                }
                outputController.enqueue(encoder.encode(output))
                outputController.close()
            },
        })
    }

    onElement(selector: string, handler: ElementHandler): this {
        // Validate the selector eagerly, matching Fastly's production behavior where
        // HTMLRewritingStream throws synchronously for invalid selectors.
        const probe = new HTMLRewriter(() => {})
        try {
            probe.on(selector, { element: () => {} })
        } catch (err) {
            probe.free()
            throw err
        }
        probe.free()
        this.#handlers.push({ selector, handler })
        return this
    }
}
