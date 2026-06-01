import { TransformStream } from 'node:stream/web'
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
    tagName?: string
}

function wrapElement(handler: ElementHandler) {
    return (element: FastlyElement) => {
        const _before = element.before.bind(element)
        const _prepend = element.prepend.bind(element)
        const _append = element.append.bind(element)
        const _after = element.after.bind(element)

        const translate =
            (origFn: (content: string, options?: FastlyElementOptions) => void) =>
            (content: string, options?: FastlyElementOptions) => {
                if (options?.escapeHTML) {
                    origFn(content)
                } else {
                    origFn(content, { html: true })
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
 * Test double for Fastly's HTMLRewritingStream. Extends TransformStream so
 * production code can use response.body.pipeThrough(stream).
 */
export class HTMLRewritingStream extends TransformStream<Uint8Array, Uint8Array> {
    readonly #handlers: { selector: string; handler: ElementHandler }[]

    constructor() {
        const handlers: { selector: string; handler: ElementHandler }[] = []
        const inputChunks: Uint8Array[] = []

        super({
            transform(chunk) {
                inputChunks.push(chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk)))
            },
            flush(controller) {
                let output = ''
                const rewriter = new HTMLRewriter((chunk: BufferSource) => {
                    output += decoder.decode(chunk)
                })

                for (const { selector, handler } of handlers) {
                    try {
                        rewriter.on(selector, { element: wrapElement(handler) as never })
                    } catch {
                        // Skip selectors that are invalid at processing time.
                    }
                }

                try {
                    for (const chunk of inputChunks) {
                        rewriter.write(chunk)
                    }
                    rewriter.end()
                } finally {
                    rewriter.free()
                }

                controller.enqueue(encoder.encode(output))
            },
        })

        this.#handlers = handlers
    }

    onElement(selector: string, handler: ElementHandler): this {
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
