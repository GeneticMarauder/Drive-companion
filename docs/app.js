import Anthropic from './vendor/anthropic-sdk.js'
import { Game, detectFormat } from './engine.js'
import { CoPilot } from './agent.js'
import { Speaker, Listener } from './voice.js'
import { games, saveStoreFor, settings, persist } from './store.js'

const BUNDLED = [
  { id: 'bundled:lantern-hill', title: 'Lantern Hill', note: 'A 5-minute test game. Try it in the driveway.', url: 'games/lantern-hill.ulx' },
]

const $ = (id) => document.getElementById(id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const speaker = new Speaker()
const listener = new Listener()

const state = {
  meta: null, game: null, pilot: null,
  running: false, paused: false, loopId: 0,
  lastSpoken: '', wakeLock: null, busy: Promise.resolve(), costSeen: 0,
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
  const list = $('gameList')
  list.textContent = ''
  for (const g of [...stored, ...BUNDLED]) {
    const card = document.createElement('div')
    card.className = 'card game'
    const info = document.createElement('div')
    info.innerHTML = '<div class="title"></div><div class="meta"></div>'
    info.querySelector('.title').textContent = g.title
    info.querySelector('.meta').textContent = g.note ?? `${(g.bytes.byteLength / 1048576).toFixed(1)} MB story file`
    card.append(info)
    const btns = document.createElement('div')
    btns.className = 'row'
    btns.style.flex = '0 0 auto'
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
    card.append(btns)
    list.append(card)
  }
}

$('addGame').onclick = () => $('filePicker').click()
$('filePicker').onchange = async (e) => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!detectFormat(bytes)) {
    alert('That file isn\'t a story file this app can run. Look for a file ending in .gblorb, .ulx, .zblorb, .z5 or .z8.')
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
  speaker.say('This is how I will sound.')
}
$('rateSelect').value = String(settings.rate)
speaker.rate = settings.rate
$('rateSelect').onchange = (e) => {
  settings.rate = Number(e.target.value)
  speaker.rate = settings.rate
  speaker.unlock()
  speaker.say('This is how fast I will read.')
}
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', renderVoices)

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
  setOrb('idle', 'Loading…')
  state.meta = meta
  try {
    const bytes = meta.url ? new Uint8Array(await (await fetch(meta.url)).arrayBuffer()) : meta.bytes
    state.game = await Game.start(bytes, { saveStore: saveStoreFor(meta.id) })
  } catch (err) {
    setOrb('error', 'Could not load')
    $('said').textContent = `This game failed to start: ${err.message}`
    return
  }
  const key = settings.apiKey
  const client = key ? new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 30000 }) : null
  state.pilot = new CoPilot({ client, game: state.game, title: meta.title, log: addLog })
  state.costSeen = 0
  updateStatus()
  updateCost()
  setOrb('idle', state.game.hasSave ? 'Tap to continue' : 'Tap to start')
  if (!client) $('said').textContent = 'No API key saved, so your words go straight to the game. Add a key on the home screen for the full co-pilot.'
}

async function start() {
  speaker.unlock()
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
      addLog(`[restored]\n${text}`)
      await speak(`Welcome back to ${state.meta.title}. ${text}`)
    } else {
      state.pilot.note('Game opening, read aloud to the driver', g.intro)
      addLog(g.intro)
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
        $('said').textContent = 'Microphone access is blocked. In Chrome, tap the icon left of the address, allow the microphone, then tap the circle again.'
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
    if (RE.resume.test(norm)) { setPaused(false); await speak('Okay, back in the game.') }
    return
  }
  if (RE.repeat.test(norm)) return speak(state.lastSpoken || 'Nothing to repeat yet.')
  if (RE.pause.test(norm)) { setPaused(true); return speak('Paused. Say resume when you\'re ready.') }
  if (RE.slower.test(norm) || RE.faster.test(norm)) {
    speaker.rate = Math.min(1.6, Math.max(0.7, speaker.rate + (RE.slower.test(norm) ? -0.15 : 0.15)))
    settings.rate = speaker.rate
    return speak(RE.slower.test(norm) ? 'Okay, I\'ll read slower.' : 'Okay, I\'ll read faster.')
  }
  if (RE.cost.test(norm)) {
    const c = state.pilot.costUSD * 100
    return speak(`This session has cost about ${c < 1 ? 'less than one cent' : `${Math.round(c)} cents`}.`)
  }

  setOrb('thinking')
  const r = await state.pilot.handle(text)
  updateCost()
  updateStatus()
  const saving = r.commands.length ? state.game.autosave().catch(() => false) : null
  if (r.speak) await speak(r.speak)
  else $('heard').textContent = `(ignored) “${text}”`
  await saving
}

async function speak(text) {
  if (!text) return
  state.lastSpoken = text
  $('said').textContent = text
  listener.stop()
  setOrb('speaking')
  await speaker.say(text)
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
  speaker.stop()
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
  $('cost').textContent = state.pilot?.client ? `$${c.toFixed(3)} this session` : 'Direct mode'
}

function addLog(text) {
  const log = $('log')
  log.textContent += `${text}\n\n`
  if (log.textContent.length > 60000) log.textContent = log.textContent.slice(-40000)
  log.scrollTop = log.scrollHeight
}

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
  if (s === 'speaking') return speaker.stop()
  if (s === 'paused') return setPaused(false)
  if (s === 'listening') return setPaused(true)
}
$('orb').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('orb').click() } }
$('pauseBtn').onclick = () => { if (state.running) setPaused(!state.paused) }
$('repeatBtn').onclick = () => { speaker.unlock(); exclusive(() => speak(state.lastSpoken || 'Nothing to repeat yet.')) }
$('typedForm').onsubmit = (e) => {
  e.preventDefault()
  const text = $('typed').value.trim()
  if (!text || !state.pilot) return
  $('typed').value = ''
  speaker.unlock()
  listener.stop()
  exclusive(() => handleUtterance(text))
}
$('back').onclick = () => {
  stopRunning()
  state.game = null
  $('play').classList.add('hidden')
  $('home').classList.remove('hidden')
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

renderKey()
renderGames()
renderVoices()
renderSupport()
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
