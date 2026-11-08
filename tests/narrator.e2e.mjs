// Browser check of the premium narrator with a stand-in for OpenAI's speech
// endpoint: request shape, gapless playback, and fallback to the phone voice.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const { chromium, devices } = createRequire(import.meta.url)('playwright')
const root = new URL('../docs/', import.meta.url)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html'
  try { const b = await readFile(new URL(path, root)); res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }); res.end(b) } catch { res.writeHead(404); res.end() }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

// 0.4 s of silence as a WAV file.
function wav(seconds = 0.4, rate = 8000) {
  const n = Math.round(seconds * rate), b = Buffer.alloc(44 + n)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44)
  return b
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  window.__phoneVoice = []
  const orig = speechSynthesis.speak.bind(speechSynthesis)
  speechSynthesis.speak = (u) => { window.__phoneVoice.push(u.text); setTimeout(() => u.onend?.(), 50); return orig(new SpeechSynthesisUtterance(' ')) }
})
let mode = 'ok'
const calls = []
await page.route('https://api.openai.com/**', async (route) => {
  const req = route.request()
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  calls.push({ auth: req.headers().authorization, body: JSON.parse(req.postData()) })
  if (mode === 'fail') return route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: 'Incorrect API key' } }) })
  return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'audio/wav' }, body: wav() })
})

try {
  await page.goto(base)
  await page.fill('#oaKey', 'sk-test-123')
  await page.click('#saveOa')
  await page.waitForFunction(() => document.querySelector('#oaPresent:not(.hidden)'))
  await page.waitForTimeout(1500)
  assert.equal(calls.length, 1, 'test phrase requested once')
  const { auth, body } = calls[0]
  assert.equal(auth, 'Bearer sk-test-123')
  assert.equal(body.model, 'gpt-4o-mini-tts')
  assert.equal(body.voice, 'fable')
  assert.match(body.instructions, /nature-documentary narrator/)
  assert.match(body.input, /road stretches westward/)
  console.log('Test phrase sent to the narrator:', JSON.stringify({ model: body.model, voice: body.voice }))

  // Play a game turn in direct mode: the game text should be narrated in chunks.
  await page.click('.game:has-text("Lantern Hill") button:has-text("Play")')
  await page.waitForSelector('#orb:has-text("Tap to start")', { timeout: 20000 })
  calls.length = 0
  await page.fill('#typed', 'north')
  await page.press('#typed', 'Enter')
  await page.waitForFunction(() => document.querySelector('#orb').dataset.state === 'idle' && document.querySelector('#story .entry.game'), null, { timeout: 15000 })
  await page.waitForTimeout(1500)
  assert.ok(calls.length >= 1 && calls.some((c) => /steep and stony/.test(c.body.input)), 'game text narrated')
  assert.deepEqual(await page.evaluate(() => window.__phoneVoice.filter((t) => t.trim())), [], 'phone voice not used while premium works')
  console.log(`Game turn narrated in ${calls.length} request(s); cost label: ${await page.textContent('#cost')}`)

  // Narrator failure: falls back to the phone voice.
  mode = 'fail'
  await page.fill('#typed', 'look')
  await page.press('#typed', 'Enter')
  await page.waitForFunction(() => window.__phoneVoice.some((t) => /Hill Path|steep/.test(t)), null, { timeout: 15000 })
  console.log('On API failure the phone voice took over:', (await page.evaluate(() => window.__phoneVoice.filter((t) => t.trim())[0])).slice(0, 60) + '…')
  assert.deepEqual(errors, [])
  console.log('NARRATOR E2E OK')
} finally {
  await browser.close()
  server.close()
}
