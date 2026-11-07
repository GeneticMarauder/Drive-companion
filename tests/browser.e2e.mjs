// End-to-end check of the real page in headless Chromium (phone-sized).
// Serves docs/ locally, opens Lantern Hill, plays typed turns through the
// co-pilot (speech recognition can't run headless), and checks that progress
// survives a reload. Uses Claude when ANTHROPIC_API_KEY is set, otherwise
// direct mode.
//   node tests/browser.e2e.mjs [screenshot.png]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const { chromium, devices } = createRequire(import.meta.url)('playwright')
const root = new URL('../docs/', import.meta.url)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ulx': 'application/octet-stream' }

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html'
  try {
    const body = await readFile(new URL(path, root))
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('not found') }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['Pixel 7'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

// Relay Anthropic API calls through Node's fetch. Some sandboxes intercept
// TLS with a private CA that Node trusts but headless Chromium doesn't; a
// real phone talks to api.anthropic.com directly and never needs this.
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request()
  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  }
  const headers = { ...req.headers() }
  delete headers['content-length']
  const res = await fetch(req.url(), { method: req.method(), headers, body: req.postDataBuffer() ?? undefined })
  const out = Object.fromEntries(res.headers)
  delete out['content-encoding']
  delete out['content-length']
  out['access-control-allow-origin'] = '*'
  await route.fulfill({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) })
})

const key = process.env.ANTHROPIC_API_KEY
try {
  await page.goto(base)
  if (key) {
    await page.fill('#keyInput', key)
    await page.click('#saveKey')
    await page.waitForSelector('#keyPresent:not(.hidden)')
  }
  await page.click('.game:has-text("Lantern Hill") button:has-text("Play")')
  await page.waitForSelector('#orb:has-text("Tap to start")', { timeout: 20000 })
  console.log('status:', await page.textContent('#statusLine'))

  const turn = async (text, expect) => {
    const before = await page.textContent('#said')
    await page.fill('#typed', text)
    await page.press('#typed', 'Enter')
    await page.waitForFunction((b) => {
      const s = document.querySelector('#said').textContent
      return s && s !== b
    }, before, { timeout: 60000 })
    const said = await page.textContent('#said')
    console.log(`> ${text}\n  ${said}\n`)
    if (expect) assert.match(said, expect)
  }

  await turn("let's walk up the hill to the lantern", /hill|lantern|path/i)
  await turn('go the rest of the way up and open the little hatch on the lantern', /key/i)
  await page.waitForTimeout(500) // let the background autosave finish
  console.log('status:', await page.textContent('#statusLine'), '|', await page.textContent('#cost'))

  // Reload: the game should offer to continue from the autosave.
  await page.reload()
  await page.click('.game:has-text("Lantern Hill") button:has-text("Play")')
  await page.waitForSelector('#orb:has-text("Tap to continue")', { timeout: 20000 })
  console.log('After reload the orb says "Tap to continue" (autosave found).')

  if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
  assert.deepEqual(errors.filter((e) => !/speech|favicon/i.test(e)), [], 'no page errors')
  console.log('E2E OK')
} finally {
  await browser.close()
  server.close()
}
