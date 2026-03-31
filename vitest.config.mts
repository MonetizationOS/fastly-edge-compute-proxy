import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    resolve: {
        alias: {
            'fastly:html-rewriter': resolve(__dirname, 'test/mocks/fastly-html-rewriter.ts'),
        },
    },
    test: {
        environment: 'node',
        setupFiles: ['./test/setup.ts'],
    },
})
