export async function parseSurfaceDecisionsBody(call: unknown[]): Promise<Record<string, unknown>> {
    const request = call[0]
    if (!(request instanceof Request)) {
        throw new Error('Expected surface decisions fetch to receive a Request')
    }
    return (await request.clone().json()) as Record<string, unknown>
}

export function findSurfaceDecisionsCall(fetchMock: { mock: { calls: unknown[][] } }): unknown[] | undefined {
    return fetchMock.mock.calls.find(([urlOrRequest]) => {
        const url = urlOrRequest instanceof Request ? urlOrRequest.url : String(urlOrRequest)
        return url.includes('/api/v1/surface-decisions')
    })
}
