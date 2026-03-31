// Fastly Compute@Edge globals not available in Node.js test environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof addEventListener === 'undefined') {
    ;(globalThis as any).addEventListener = () => {}
}
