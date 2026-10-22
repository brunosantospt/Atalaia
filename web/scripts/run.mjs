// Runs a TypeScript script of web/ in node through Vite's module runner, which resolves and
// transforms src/ as the dev server does, so no other runner is needed:
// node scripts/run.mjs scripts/ils-check.ts [args]

import { runnerImport } from 'vite'

await runnerImport(process.argv[2], {
  plugins: [{
    name: 'script-style-stub',
    enforce: 'pre',
    resolveId(source) { if (source.endsWith('.css')) return '\0atalaia-script-style' },
    load(id) { if (id === '\0atalaia-script-style') return 'export default {}' },
  }],
})
