declare module 'fastly:security' {
    export function inspect(request: Request, config: InspectConfig): InspectResponse

    export interface InspectConfig {
        corp: string
        workspace: string
        overrideClientIp?: string
    }

    export interface InspectResponse {
        waf_response: number
        redirect_url?: string
        tags: string[]
        verdict: string
        decision_ms: number
    }
}
