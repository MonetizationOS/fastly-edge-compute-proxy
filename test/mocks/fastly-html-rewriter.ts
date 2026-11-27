import { TransformStream } from 'node:stream/web'
import { HTMLRewriter } from 'html-rewriter-wasm'

const encoder = new TextEncoder()

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
 * production code can use response.body.pipeThrough(stream). Rewrites each
 * chunk as it arrives, like the real stream.
 */
export class HTMLRewritingStream extends TransformStream<Uint8Array, Uint8Array> {
    readonly #handlers: { selector: string; handler: ElementHandler }[]

    constructor() {
        const handlers: { selector: string; handler: ElementHandler }[] = []
        let output: Uint8Array[] = []
        let rewriter: HTMLRewriter | null = null

        const start = () => {
            const created = new HTMLRewriter((chunk: Uint8Array) => {
                output.push(chunk.slice())
            })
            for (const { selector, handler } of handlers) {
                try {
                    created.on(selector, { element: wrapElement(handler) as never })
                } catch {
                    // Skip selectors that are invalid at processing time.
                }
            }
            return created
        }
        const drain = (controller: TransformStreamDefaultController<Uint8Array>) => {
            for (const chunk of output) controller.enqueue(chunk)
            output = []
        }

        super({
            async transform(chunk, controller) {
                rewriter ??= start()
                await rewriter.write(chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk)))
                drain(controller)
            },
            async flush(controller) {
                rewriter ??= start()
                try {
                    await rewriter.end()
                } finally {
                    rewriter.free()
                }
                drain(controller)
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
