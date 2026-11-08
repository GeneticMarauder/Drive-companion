import Anthropic from './vendor/anthropic-sdk.js'
import { Game, detectFormat } from './engine.js'
import { CoPilot } from './agent.js'
import { Speaker, Listener } from './voice.js'
import { Narrator, NARRATOR_VOICES } from './narrator.js'
import { games, saveStoreFor, settings, persist } from './store.js'
import { CATALOG } from './catalog.js'
import { extractStory } from './unzip.js'

const BUNDLED = [
  { id: 'bundled:lantern-hill', title: 'Lantern Hill', note: 'A 5-minute test game. Try it in the driveway.', url: 'games/lantern-hill.ulx' },
]

const $ = (id) => document.getElementById(id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const speaker = new Speaker()
const listener = new Listener()
const narrator = new Narrator({
  fallback: speaker,
  getKey: () => (settings.narrator === 'premium' ? settings.openaiKey : ''),
  getVoice: () => settings.narratorVoice,
  onCost: (usd) => { state.voiceCost += usd; settings.totalCost += usd; updateCost() },
  log: (m) => addLog(m),
})

const state = {
  meta: null, game: null, pilot: null,
  running: false, paused: false, loopId: 0,
  lastSpoken: '', wakeLock: null, busy: Promise.resolve(), costSeen: 0, voiceCost: 0,
  story: [], // [{k: 'game'|'cmd'|'you'|'pilot'|'note', t: text}]
}

// ---------- Home screen ----------

function renderKey() {
  const key = settings.apiKey
  $('keyMissing').classList.toggle('hidden', !!key)
  $('keyPresent').classList.toggle('hidden', !key)
  $('keyHint').textContent = key ? `(…${key.slice(-4)})` : ''
  $('totalCost').textContent = `Claude usage so far on this phone: about $${settings.totalCost.toFixed(2)}`
}

$('saveKey').onclick = () => {
  const v = $('keyInput').value.trim()
  if (!/^sk-ant-/.test(v)) { alert('That doesn\'t look like an Anthropic key. It should start with sk-ant-.'); return }
  settings.apiKey = v
  $('keyInput').value = ''
  renderKey()
}
$('removeKey').onclick = () => {
  if (confirm('Remove the API key from this phone? The co-pilot will fall back to passing your words straight to the game.')) {
    settings.apiKey = ''
    renderKey()
  }
}

async function renderGames() {
  const stored = (await games.list().catch(() => [])).sort((a, b) => b.addedAt - a.addedAt)
  const have = new Map(stored.map((g) => [g.id, g]))

  // Featured games: Download until they're on the phone, then Play.
  const cat = $('catalogList')
  cat.textContent = ''
  for (const c of CATALOG) cat.append(gameCard({ ...c, ...(have.get(c.id) ?? {}), note: c.blurb, catalog: c }, have.has(c.id)))
  const missing = CATALOG.filter((c) => !have.has(c.id))
  $('downloadAll').classList.toggle('hidden', missing.length === 0)
  $('downloadAll').textContent = missing.length === CATALOG.length ? 'Download all three' : `Download the other ${missing.length === 1 ? 'one' : missing.length}`

  const list = $('gameList')
  list.textContent = ''
  for (const g of stored.filter((g) => !g.id.startsWith('catalog:'))) list.append(gameCard(g, true))
  for (const g of BUNDLED) list.append(gameCard(g, true))
}

function gameCard(g, ready) {
  const card = document.createElement('div')
  card.className = 'card game'
  const info = document.createElement('div')
  info.innerHTML = '<div class="title"></div><div class="meta"></div>'
  info.querySelector('.title').textContent = g.catalog ? `${g.title}` : g.title
  const meta = [g.catalog?.byline, g.note ?? (g.bytes ? `${(g.bytes.byteLength / 1048576).toFixed(1)} MB story file` : '')]
  if (ready && g.bytes && g.catalog) meta.push(`Downloaded (${(g.bytes.byteLength / 1048576).toFixed(1)} MB)`)
  info.querySelector('.meta').textContent = meta.filter(Boolean).join(' · ')
  card.append(info)
  const btns = document.createElement('div')
  btns.className = 'row'
  if (!ready) {
    const dl = document.createElement('button')
    dl.textContent = 'Download'
    dl.onclick = () => downloadGames([g.catalog])
    btns.append(dl)
  } else {
    if (!g.url) {
      const del = document.createElement('button')
      del.textContent = 'Remove'
      del.className = 'danger'
      del.onclick = async () => {
        if (!confirm(`Remove ${g.title} and its saved progress from this phone?`)) return
        await games.remove(g.id)
        await saveStoreFor(g.id).clear()
        renderGames()
      }
      btns.append(del)
    }
    const play = document.createElement('button')
    play.textContent = 'Play'
    play.className = 'primary'
    play.onclick = () => openGame(g)
    btns.append(play)
  }
  card.append(btns)
  return card
}

let downloading = false
async function downloadGames(list) {
  if (downloading) return
  downloading = true
  $('downloadAll').disabled = true
  const msg = $('downloadMsg')
  const failed = []
  for (const c of list) {
    try {
      const bytes = await fetchWithProgress(c.download, (got, total) => {
        msg.textContent = `Downloading ${c.title}… ${(got / 1048576).toFixed(1)}${total ? ` of ${(total / 1048576).toFixed(1)}` : ''} MB`
      })
      msg.textContent = `Unpacking ${c.title}…`
      const story = await extractStory(bytes)
      if (!detectFormat(story)) throw new Error('the download isn\'t a playable story file')
      await games.put({ id: c.id, title: c.title, bytes: story, addedAt: Date.now() })
      persist()
    } catch (err) {
      failed.push(c)
      console.error(err)
    }
    await renderGames()
  }
  downloading = false
  $('downloadAll').disabled = false
  if (!failed.length) {
    msg.textContent = list.length > 1 ? 'All set. Every game is on this phone.' : `${list[0].title} is ready.`
  } else {
    msg.innerHTML = ''
    msg.append(`Couldn't download ${failed.map((c) => c.title).join(' and ')}. Check your connection and try again. If it keeps failing, get the story file from `)
    failed.forEach((c, i) => {
      const a = document.createElement('a')
      a.href = c.ifdb; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `${c.title} on IFDB`
      if (i) msg.append(', ')
      msg.append(a)
    })
    msg.append(' and add it with "Add another game file".')
  }
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const parts = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    onProgress(got, total)
  }
  const out = new Uint8Array(got)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

$('downloadAll').onclick = async () => {
  const have = new Set((await games.list().catch(() => [])).map((g) => g.id))
  downloadGames(CATALOG.filter((c) => !have.has(c.id)))
}

$('addGame').onclick = () => $('filePicker').click()
$('filePicker').onchange = async (e) => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  let bytes = new Uint8Array(await file.arrayBuffer())
  try { bytes = await extractStory(bytes) } catch {}
  if (!detectFormat(bytes)) {
    alert('That file isn\'t a story file this app can run. Look for a file ending in .gblorb, .ulx, .zblorb, .z5 or .z8, or a .zip containing one.')
    return
  }
  await games.put({ id: `file:${file.name}:${file.size}`, title: titleFromFilename(file.name), bytes, addedAt: Date.now() })
  persist()
  renderGames()
}

function titleFromFilename(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
}

function renderVoices() {
  const sel = $('voiceSelect')
  const voices = speaker.voices()
  sel.textContent = ''
  const auto = new Option('Automatic (best English voice)', '')
  sel.append(auto)
  for (const v of voices) sel.append(new Option(`${v.name} (${v.lang})`, v.name))
  sel.value = settings.voice
  speaker.voiceName = settings.voice || null
}
$('voiceSelect').onchange = (e) => {
  settings.voice = e.target.value
  speaker.voiceName = e.target.value || null
  speaker.unlock()
  speaker.say('This is how the phone voice sounds.')
}
$('rateSelect').value = String(settings.rate)
speaker.rate = settings.rate
$('rateSelect').onchange = (e) => {
  settings.rate = Number(e.target.value)
  speaker.rate = settings.rate
  testVoice()
}
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', renderVoices)

function renderNarrator() {
  const mode = settings.narrator
  $('narratorMode').value = mode
  $('premiumBox').classList.toggle('hidden', mode !== 'premium')
  $('phoneBox').classList.toggle('hidden', mode === 'premium')
  const k = settings.openaiKey
  $('oaMissing').classList.toggle('hidden', !!k)
  $('oaPresent').classList.toggle('hidden', !k)
  $('oaHint').textContent = k ? `(…${k.slice(-4)})` : ''
  const sel = $('narratorVoice')
  if (!sel.options.length) for (const v of NARRATOR_VOICES) sel.append(new Option(v.label, v.id))
  sel.value = settings.narratorVoice
}
$('narratorMode').onchange = (e) => { settings.narrator = e.target.value; renderNarrator() }
$('narratorVoice').onchange = (e) => { settings.narratorVoice = e.target.value; testVoice() }
$('saveOa').onclick = () => {
  const v = $('oaKey').value.trim()
  if (!/^sk-/.test(v)) { alert('That doesn\'t look like an OpenAI key. It should start with sk-.'); return }
  settings.openaiKey = v
  $('oaKey').value = ''
  renderNarrator()
  testVoice()
}
$('removeOa').onclick = () => {
  if (confirm('Remove the OpenAI key from this phone? The phone\'s built-in voice will be used instead.')) { settings.openaiKey = ''; renderNarrator() }
}
$('testVoice').onclick = () => testVoice()
function testVoice() {
  narrator.unlock()
  narrator.say('The road stretches westward, and somewhere ahead, a story is waiting. Shall we begin?')
}

function renderSupport() {
  const problems = []
  if (!listener.supported) problems.push('This browser can\'t listen for speech. Use Chrome on Android.')
  if (!speaker.supported) problems.push('This browser can\'t read text aloud.')
  $('support').textContent = problems.join(' ')
}

// ---------- Play screen ----------

async function openGame(meta) {
  $('home').classList.add('hidden')
  $('play').classList.remove('hidden')
  $('log').textContent = ''
  $('said').textContent = ''
  $('heard').textContent = ''
  document.querySelector('main').classList.add('playing')
  setOrb('idle', 'Loading…')
  state.meta = meta
  state.story = []
  $('story').textContent = ''
  const saved = await saveStoreFor(meta.id).get('story').catch(() => null)
  if (Array.isArray(saved)) for (const e of saved) addStory(e.k, e.t, { save: false })
  try {
    const bytes = meta.url ? new Uint8Array(await (await fetch(meta.url)).arrayBuffer()) : meta.bytes
    state.game = await Game.start(bytes, { saveStore: saveStoreFor(meta.id) })
  } catch (err) {
    setOrb('error', 'Could not load')
    addStory('note', `This game failed to start: ${err.message}`, { bad: true, save: false })
    return
  }
  const key = settings.apiKey
  const client = key ? new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 30000 }) : null
  state.pilot = new CoPilot({ client, game: state.game, title: meta.title, log: addLog })
  state.costSeen = 0
  state.voiceCost = 0
  updateStatus()
  updateCost()
  setOrb('idle', state.game.hasSave ? 'Tap to continue' : 'Tap to start')
  if (!state.story.length) addStory('note', 'Tap the circle to start. The story will appear here as it\'s read aloud.', { save: false, temp: true })
  if (!client) addStory('note', 'No API key saved, so your words go straight to the game. Add a key on the home screen for the full co-pilot.', { save: false })
}

async function start() {
  narrator.unlock()
  state.running = true
  state.paused = false
  const id = ++state.loopId
  keepAwake()
  persist()
  await exclusive(async () => {
    const g = state.game
    if (g.hasSave) {
      await g.restore()
      const { text } = await g.send('look')
      state.pilot.note('Restored the saved game. The driver heard', text)
      addStory('note', '— Continuing where you left off —')
      addStory('game', text)
      await speak(`Welcome back to ${state.meta.title}. ${text}`)
    } else {
      state.pilot.note('Game opening, read aloud to the driver', g.intro)
      addStory('game', g.intro)
      await speak(g.intro)
    }
    updateStatus()
  })
  loop(id)
}

async function loop(id) {
  let failures = 0
  while (state.running && id === state.loopId) {
    await state.busy
    if (!state.running || id !== state.loopId) return
    setOrb(state.paused ? 'paused' : 'listening')
    let heard
    try {
      heard = await listener.listenOnce({ onInterim: (t) => { $('heard').textContent = t } })
      failures = 0
    } catch (err) {
      if (err.code === 'not-allowed' || err.code === 'service-not-allowed') {
        stopRunning()
        setOrb('error', 'Mic blocked')
        addStory('note', 'Microphone access is blocked. In Chrome, tap the icon left of the address, allow the microphone, then tap the circle again.', { bad: true, save: false })
        return
      }
      failures++
      setOrb('error', failures > 2 ? 'No speech signal' : 'Retrying')
      if (failures === 3) await speak('I\'m having trouble hearing. Speech recognition may need a signal. I\'ll keep trying.')
      await sleep(Math.min(20000, 1000 * 2 ** failures))
      continue
    }
    if (!state.running || id !== state.loopId) return
    if (!heard) continue
    await exclusive(() => handleUtterance(heard))
  }
}

// Run one thing at a time (a spoken turn, a typed turn, the opening).
function exclusive(fn) {
  const run = state.busy.then(fn)
  state.busy = run.catch((err) => addLog(`Error: ${err?.message ?? err}`))
  return state.busy
}

const RE = {
  repeat: /^(repeat( that)?( please)?|say (that|it) again|come again|pardon|sorry what|what did you say)$/,
  pause: /^(pause|pause (the )?game|stop listening|take a break|hold on|hang on|be quiet|quiet|stop|shh+)$/,
  resume: /\b(resume|unpause|i'?m back|let'?s (play|continue|go)|continue|keep going|start listening)\b/,
  slower: /^(slow(er)?( down)?|(speak|talk|read) slower)( please)?$/,
  faster: /^(speed up|faster|(speak|talk|read) faster)( please)?$/,
  cost: /how much (have we|did we|has (this|it)|does this) (spent|spend|cost)/,
}

async function handleUtterance(text) {
  $('heard').textContent = `“${text}”`
  const norm = text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim()

  if (state.paused) {
    if (RE.resume.test(norm)) { setPaused(false); addStory('note', 'Resumed'); await speak('Okay, back in the game.') }
    return
  }
  if (RE.repeat.test(norm)) return speak(state.lastSpoken || 'Nothing to repeat yet.')
  if (RE.pause.test(norm)) { setPaused(true); addStory('note', 'Paused'); return speak('Paused. Say resume when you\'re ready.') }
  if (RE.slower.test(norm) || RE.faster.test(norm)) {
    narrator.rate = Math.min(1.6, Math.max(0.7, narrator.rate + (RE.slower.test(norm) ? -0.15 : 0.15)))
    settings.rate = narrator.rate
    return speak(RE.slower.test(norm) ? 'Okay, I\'ll read slower.' : 'Okay, I\'ll read faster.')
  }
  if (RE.cost.test(norm)) {
    const c = (state.pilot.costUSD + state.voiceCost) * 100
    return speak(`This session has cost about ${c < 1 ? 'less than one cent' : `${Math.round(c)} cents`}.`)
  }

  setOrb('thinking')
  const r = await state.pilot.handle(text)
  updateCost()
  updateStatus()
  if (r.speak || r.commands.length) {
    addStory('you', `You: “${text}”`)
    for (const c of r.commands) {
      addStory('cmd', `> ${c.command}`)
      addStory('game', c.output)
    }
    if (r.speak && addsSomething(r.speak, r.commands)) addStory('pilot', r.speak)
  }
  const saving = r.commands.length ? state.game.autosave().catch(() => false) : null
  if (r.speak) await speak(r.speak)
  else $('heard').textContent = `(ignored) “${text}”`
  await saving
  // Typed turns can happen before the voice loop starts; don't leave the circle stuck.
  if (!state.running) setOrb('idle', state.game?.hasSave ? 'Tap to continue' : 'Tap to start')
}

async function speak(text) {
  if (!text) return
  state.lastSpoken = text
  $('said').textContent = text
  listener.stop()
  setOrb('speaking')
  await narrator.say(text)
}

function setPaused(p) {
  state.paused = p
  $('pauseBtn').textContent = p ? 'Resume' : 'Pause'
  setOrb(p ? 'paused' : 'listening')
}

function stopRunning() {
  state.running = false
  state.loopId++
  listener.stop()
  narrator.stop()
  state.wakeLock?.release?.().catch(() => {})
  state.wakeLock = null
}

const ORB_TEXT = { idle: 'Tap to start', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking\n(tap to skip)', paused: 'Paused\n(say “resume”)', error: 'Problem' }
function setOrb(s, label) {
  const orb = $('orb')
  orb.dataset.state = s
  orb.textContent = label ?? ORB_TEXT[s]
  orb.style.whiteSpace = 'pre-line'
}

function updateStatus() { $('statusLine').textContent = state.game?.status ?? '' }

function updateCost() {
  const c = state.pilot?.costUSD ?? 0
  settings.totalCost += c - state.costSeen
  state.costSeen = c
  const total = c + state.voiceCost
  $('cost').textContent = state.pilot?.client || state.voiceCost ? `$${total.toFixed(3)} this session` : 'Direct mode'
}

function addLog(text) {
  const log = $('log')
  log.textContent += `${text}\n\n`
  if (log.textContent.length > 60000) log.textContent = log.textContent.slice(-40000)
  log.scrollTop = log.scrollHeight
}

// ---------- Story view ----------

function addStory(kind, text, { save = true, bad = false, temp = false } = {}) {
  text = String(text ?? '').trim()
  if (!text) return
  const box = $('story')
  box.querySelector('.entry.temp')?.remove()
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160
  const div = document.createElement('div')
  div.className = `entry ${kind}${bad ? ' bad' : ''}${temp ? ' temp' : ''}`
  // Show a room name (a short first line without end punctuation) as a heading.
  const [first, ...rest] = text.split('\n')
  if (kind === 'game' && rest.length && first.length < 60 && !/[.!?:,"')\]]$/.test(first.trim())) {
    const h = document.createElement('strong')
    h.className = 'room'
    h.textContent = first
    div.append(h, '\n' + rest.join('\n'))
  } else {
    div.textContent = text
  }
  box.append(div)
  while (box.childElementCount > 600) box.firstElementChild.remove()
  if (nearBottom || kind === 'you' || kind === 'note') div.scrollIntoView({ block: kind === 'game' ? 'nearest' : 'end' })
  if (!save) return
  state.story.push({ k: kind, t: text })
  if (state.story.length > 400) state.story = state.story.slice(-300)
  saveStory()
}

// Saved right away (IndexedDB writes are cheap and stay in order), so the
// story survives even if the app is closed straight after a turn.
function saveStory() {
  const id = state.meta?.id
  if (id) saveStoreFor(id).set('story', state.story.slice()).catch(() => {})
}

// Show the co-pilot's words on screen only when they add something beyond
// the game text already shown (answers, hints, "I tried but...").
function addsSomething(spoken, commands) {
  if (!commands.length) return true
  const seen = new Set(commands.map((c) => c.output).join(' ').toLowerCase().match(/[a-z']{4,}/g) ?? [])
  const words = spoken.toLowerCase().match(/[a-z']{4,}/g) ?? []
  if (!words.length) return false
  const novel = words.filter((w) => !seen.has(w)).length / words.length
  return novel > 0.3
}

function applyTextSize() { $('story').dataset.size = String(settings.textSize) }
$('sizeBtn').onclick = () => { settings.textSize = (settings.textSize + 1) % 4; applyTextSize() }

// Keep the screen on while playing: Chrome stops listening if the phone sleeps.
async function keepAwake() {
  try {
    const lock = await navigator.wakeLock?.request('screen')
    if (!lock) return
    state.wakeLock = lock
    lock.addEventListener('release', () => { if (state.wakeLock === lock) state.wakeLock = null })
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running && !state.wakeLock) keepAwake()
})

$('orb').onclick = () => {
  const s = $('orb').dataset.state
  if (!state.game) return
  if (!state.running) return start()
  if (s === 'speaking') return narrator.stop()
  if (s === 'paused') return setPaused(false)
  if (s === 'listening') return setPaused(true)
}
$('orb').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('orb').click() } }
$('pauseBtn').onclick = () => { if (state.running) setPaused(!state.paused) }
$('repeatBtn').onclick = () => { narrator.unlock(); exclusive(() => speak(state.lastSpoken || 'Nothing to repeat yet.')) }
$('typedForm').onsubmit = (e) => {
  e.preventDefault()
  const text = $('typed').value.trim()
  if (!text || !state.pilot) return
  $('typed').value = ''
  narrator.unlock()
  listener.stop()
  exclusive(() => handleUtterance(text))
}
$('back').onclick = () => {
  stopRunning()
  state.game = null
  $('play').classList.add('hidden')
  $('home').classList.remove('hidden')
  document.querySelector('main').classList.remove('playing')
  renderKey()
  renderGames()
}
$('newGame').onclick = async () => {
  if (!confirm(`Start ${state.meta.title} over from the beginning? Saved progress will be lost.`)) return
  stopRunning()
  await saveStoreFor(state.meta.id).clear()
  openGame(state.meta)
}

// ---------- Boot ----------

// One-tap setup link: ...#key=sk-ant-... saves the key on this phone, then
// wipes it from the address bar. The part after # is never sent to the server.
{
  const m = location.hash.match(/(?:^#|&)key=([^&]+)/)
  if (m) {
    const k = decodeURIComponent(m[1]).trim()
    if (/^sk-ant-/.test(k)) settings.apiKey = k
    history.replaceState(null, '', location.pathname + location.search)
  }
}
applyTextSize()
renderNarrator()
renderKey()
renderGames()
renderVoices()
renderSupport()
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})

// Debug handle for troubleshooting from the browser console.
globalThis.driveCompanion = { narrator, state }
