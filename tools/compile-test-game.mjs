// Compiles the bundled test adventure (tools/test-game/lantern-hill.inf) to Glulx.
import { readFile, writeFile } from 'node:fs/promises'
import { compile } from '@frotzinc/inform6-wasm'

const src = await readFile(new URL('./test-game/lantern-hill.inf', import.meta.url), 'utf8')
const r = await compile(src, { version: 'ulx', library: 'std' })
for (const d of r.diagnostics) console.log(`${d.severity} line ${d.line}: ${d.message}`)
if (!r.ok) {
  console.error(r.rawOutput)
  process.exit(1)
}
await writeFile(new URL('../docs/games/lantern-hill.ulx', import.meta.url), r.story)
console.log(`Wrote docs/games/lantern-hill.ulx (${r.story.length} bytes)`)
