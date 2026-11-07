// Copies the interpreter builds and bundles the Anthropic SDK into docs/vendor,
// so the published site needs no build step and no third-party CDN.
import { copyFile, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)
const em = new URL('node_modules/emglken/', root)
const out = new URL('docs/vendor/', root)
await mkdir(new URL('emglken/', out), { recursive: true })
for (const f of ['git.js', 'git.wasm', 'bocfel.js', 'bocfel.wasm']) {
  await copyFile(new URL(`build/${f}`, em), new URL(`emglken/${f}`, out))
}
await copyFile(new URL('LICENSE', em), new URL('emglken/LICENSE', out))

await build({
  stdin: { contents: "export { default } from '@anthropic-ai/sdk'", resolveDir: root.pathname },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  outfile: new URL('anthropic-sdk.js', out).pathname,
})
console.log('Vendor files written to docs/vendor/')
