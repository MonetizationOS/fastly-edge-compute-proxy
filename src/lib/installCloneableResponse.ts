/** Marks the wrapped Response constructor so installCloneableResponse() is idempotent. */
const INSTALLED_FLAG = '__mosCloneableInstalled'

type SnapshotBody = null | string | Uint8Array

const UNSNAPSHOTABLE = Symbol('unsnapshotable')

type ResponseConstructor = {
    new (body?: BodyInit | null, init?: ResponseInit): Response
    prototype: Response
    error?: () => Response
    redirect?: (url: string | URL, status?: number) => Response
    json?: (data: unknown, init?: ResponseInit) => Response
}

/**
 * On Fastly Compute, Response has no clone().
 * mos-proxy uses response.clone() for fail-open snapshots during the HTML pipeline.
 * This wraps Response so every body gets an own-property clone(): buffered bodies
 * rebuild from a copy, stream bodies tee like the WHATWG clone().
 */
export function installCloneableResponse(): void {
    const OriginalResponse = globalThis.Response as ResponseConstructor & {
        [INSTALLED_FLAG]?: boolean
    }

    if (OriginalResponse[INSTALLED_FLAG]) {
        return
    }

    function createCloneableResponse(body?: BodyInit | null, init?: ResponseInit): Response {
        if (body instanceof ReadableStream) {
            const teeable = teeableBodies.get(body) ?? createTeeableBody(body)
            const response = new OriginalResponse(teeable.stream, init)
            defineClone(response, (cloneInit) => createCloneableResponse(teeable.branch(), cloneInit))
            return response
        }

        const response = new OriginalResponse(body, init)
        const snapshot = trySnapshotBody(body ?? null)

        if (snapshot !== UNSNAPSHOTABLE) {
            defineClone(response, (cloneInit) => createCloneableResponse(copySnapshot(snapshot), cloneInit))
        }

        return response
    }

    const CloneableResponse = function Response(
        this: unknown,
        body?: BodyInit | null,
        init?: ResponseInit,
    ): Response {
        return createCloneableResponse(body, init)
    } as unknown as ResponseConstructor & { [INSTALLED_FLAG]?: boolean }

    CloneableResponse.prototype = OriginalResponse.prototype
    Object.setPrototypeOf(CloneableResponse, OriginalResponse)
    Object.defineProperty(CloneableResponse, 'name', { value: 'Response' })

    if (typeof OriginalResponse.error === 'function') {
        CloneableResponse.error = OriginalResponse.error.bind(OriginalResponse)
    }
    if (typeof OriginalResponse.redirect === 'function') {
        CloneableResponse.redirect = OriginalResponse.redirect.bind(OriginalResponse)
    }
    if (typeof OriginalResponse.json === 'function') {
        CloneableResponse.json = OriginalResponse.json.bind(OriginalResponse)
    }

    CloneableResponse[INSTALLED_FLAG] = true
    globalThis.Response = CloneableResponse as unknown as typeof Response
}

function trySnapshotBody(body: BodyInit | null): SnapshotBody | typeof UNSNAPSHOTABLE {
    if (body === null || body === undefined) {
        return null
    }

    if (typeof body === 'string') {
        return body
    }

    if (body instanceof Uint8Array) {
        return body.slice()
    }

    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
        return new Uint8Array(body.slice(0))
    }

    if (typeof DataView !== 'undefined' && body instanceof DataView) {
        return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength))
    }

    return UNSNAPSHOTABLE
}

function copySnapshot(snapshot: SnapshotBody): SnapshotBody {
    if (snapshot instanceof Uint8Array) {
        return snapshot.slice()
    }
    return snapshot
}

function defineClone(response: Response, cloneWith: (init: ResponseInit) => Response): void {
    Object.defineProperty(response, 'clone', {
        configurable: true,
        writable: true,
        enumerable: false,
        value: function clone(this: Response): Response {
            return cloneWith({
                status: this.status,
                statusText: this.statusText,
                headers: new Headers(this.headers),
            })
        },
    })
}

type TeeableBody = {
    /** The body every Response built on it exposes. */
    stream: ReadableStream<Uint8Array>
    /** Tees the unread source: `stream` keeps one branch, the clone gets the other. */
    branch(): ReadableStream<Uint8Array>
}

/** Keyed by `TeeableBody.stream`, so `new Response(response.body)` keeps `response.body` (mos-proxy compares them). */
const teeableBodies = new WeakMap<ReadableStream, TeeableBody>()

/**
 * Wraps a stream body so it can be teed after the Response is built. The source is only read on the first
 * pull, so a clone taken before then gets every byte. As with the WHATWG clone, an unread branch buffers what
 * its sibling reads until it is cancelled, and the source is cancelled once both branches are.
 */
function createTeeableBody(initial: ReadableStream<Uint8Array>): TeeableBody {
    let source = initial
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                reader ??= source.getReader()
                const { done, value } = await reader.read()
                if (done) {
                    controller.close()
                } else {
                    controller.enqueue(value)
                }
            },
            cancel(reason) {
                cancelled = true
                return reader ? reader.cancel(reason) : source.cancel(reason)
            },
        },
        // Pull only on read, so building a Response doesn't start the source
        { highWaterMark: 0 },
    )
    const teeable: TeeableBody = {
        stream,
        branch() {
            if (reader || cancelled || stream.locked) {
                throw new TypeError('Response.clone: body has already been used')
            }
            const [kept, cloned] = source.tee()
            source = kept
            return cloned
        },
    }
    teeableBodies.set(stream, teeable)
    return teeable
}
