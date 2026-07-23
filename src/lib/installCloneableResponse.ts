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
 * On Fastly Compute, constructed Response objects may lack a working clone().
 * mos-proxy uses response.clone() for fail-open snapshots during the HTML pipeline.
 * This wraps Response so snapshotable bodies get an own-property clone() that
 * rebuilds from a buffered copy.
 */
export function installCloneableResponse(): void {
    const OriginalResponse = globalThis.Response as ResponseConstructor & {
        [INSTALLED_FLAG]?: boolean
    }

    if (OriginalResponse[INSTALLED_FLAG]) {
        return
    }

    function createCloneableResponse(body?: BodyInit | null, init?: ResponseInit): Response {
        const response = new OriginalResponse(body, init)
        const snapshot = trySnapshotBody(body ?? null)

        if (snapshot !== UNSNAPSHOTABLE) {
            Object.defineProperty(response, 'clone', {
                configurable: true,
                writable: true,
                enumerable: false,
                value: function clone(this: Response): Response {
                    return createCloneableResponse(copySnapshot(snapshot), {
                        status: this.status,
                        statusText: this.statusText,
                        headers: new Headers(this.headers),
                    })
                },
            })
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
