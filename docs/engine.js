// Headless interactive-fiction engine wrapper.
//
// Runs a Glulx (.ulx/.gblorb) or Z-code (.z3-.z8/.zblorb) story file with the
// Emglken WebAssembly interpreters, and exposes a tiny API for the voice agent:
//
//   const game = await Game.start(bytes, { saveStore })
//   game.intro                     // text printed before the first prompt
//   const out = await game.send('open door')   // -> { text, status }
//
// Implements just enough of the GlkOte display protocol to capture the main
// story text (buffer windows) and the status line (grid windows). Works in
// browsers and in Node (for tests), with no DOM access.

const ENGINE_URLS = {
  glulx: new URL('./vendor/emglken/git.js', import.meta.url).href,
  zcode: new URL('./vendor/emglken/bocfel.js', import.meta.url).href,
}

const STORY_PATH = '/story/game'
const AUTOSAVE_NAME = 'drive-companion-autosave'

// Work out which virtual machine a story file needs from its bytes.
export function detectFormat(bytes) {
  const tag = (o) => String.fromCharCode(...bytes.subarray(o, o + 4))
  if (tag(0) === 'Glul') return 'glulx'
  if (tag(0) === 'FORM' && tag(8) === 'IFRS') {
    // Blorb: find the executable chunk type in the resource index.
    const s = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    if (s.includes('GLUL')) return 'glulx'
    if (s.includes('ZCOD')) return 'zcode'
    return null
  }
  if (bytes[0] >= 1 && bytes[0] <= 8) return 'zcode'
  return null
}

// In-memory async "Dialog" file system for Emglken. The story file is served
// from memory; save files are mirrored to `saveStore` (IndexedDB in the browser).
class MemoryDialog {
  async = true
  constructor(storyBytes, saveStore) {
    this.files = new Map([[STORY_PATH, storyBytes]])
    this.saveStore = saveStore
  }
  async init() {
    if (this.saveStore) {
      const saved = await this.saveStore.get(AUTOSAVE_NAME)
      if (saved) this.files.set(this.autosavePath(), saved)
    }
  }
  autosavePath() { return `/usr/${AUTOSAVE_NAME}.glksave` }
  get_dirs() {
    return { storyfile: '/story', system_cwd: '/usr', temp: '/tmp', working: '/usr' }
  }
  set_storyfile_dir() { return { storyfile: '/story', working: '/usr' } }
  async exists(path) { return this.files.has(path) }
  async read(path) { return this.files.get(path) ?? null }
  async delete(path) { this.files.delete(path) }
  async write(files) {
    for (const [path, data] of Object.entries(files)) {
      const copy = new Uint8Array(data)
      this.files.set(path, copy)
      if (this.saveStore && path === this.autosavePath()) await this.saveStore.set(AUTOSAVE_NAME, copy)
    }
  }
  // Called when the game asks for a file name (SAVE / RESTORE / SCRIPT). The
  // agent never needs to name files, so everything uses one autosave slot.
  async prompt(extension) {
    if (extension === '.glksave') return this.autosavePath()
    return `/usr/drive-companion${extension}`
  }
  hasAutosave() { return this.files.has(this.autosavePath()) }
}

// Minimal GlkOte implementation that collects text instead of drawing it.
class HeadlessGlkOte {
  constructor() {
    this.generation = 0
    this.windows = new Map() // id -> {type}
    this.statusLines = new Map() // grid window line -> text
    this.buffer = ''
    this.input = null // {window, type}
    this.exited = false
    this.waiters = []
  }

  init(options) {
    this.accept = options.accept
    this.Dialog = options.Dialog
    this.send({ type: 'init', metrics: { width: 80, height: 50, ...ZERO_METRICS }, support: [] })
  }

  send(ev) {
    ev.gen = this.generation
    this.accept(ev)
  }

  update(data) {
    if (data.type === 'error') return this.fail(new Error(data.message))
    if (data.type !== 'update') return
    if (data.gen === this.generation) return
    this.generation = data.gen

    for (const win of data.windows ?? []) this.windows.set(win.id, { type: win.type })
    for (const c of data.content ?? []) this.takeContent(c)

    if (data.specialinput?.type === 'fileref_prompt') {
      const sp = data.specialinput
      const ext = sp.filetype === 'save' ? '.glksave' : sp.filetype === 'data' ? '.glkdata' : '.txt'
      Promise.resolve(this.Dialog.prompt(ext, sp.filemode !== 'read')).then((filename) => {
        this.send({ type: 'specialresponse', response: 'fileref_prompt', value: filename ? { filename } : null })
      })
      return
    }

    if (data.input) {
      const req = data.input.find((i) => i.type === 'line') ?? data.input.find((i) => i.type === 'char')
      this.input = req ? { window: req.id, type: req.type } : null
    }
    if (data.disable) this.exited = true
    if (this.input || this.exited) this.wake()
  }

  takeContent(c) {
    const win = this.windows.get(c.id)
    if (win?.type === 'grid') {
      if (c.lines) for (const l of c.lines) this.statusLines.set(l.line, runsToText(l.content))
      return
    }
    if (c.clear) this.buffer += '\n'
    for (const para of c.text ?? []) {
      if (!para.append) this.buffer += '\n'
      this.buffer += runsToText(para.content)
    }
  }

  status() {
    return [...this.statusLines.keys()].sort((a, b) => a - b)
      .map((k) => this.statusLines.get(k).replace(/\s+/g, ' ').trim())
      .filter(Boolean).join(' | ')
  }

  // Resolve once the game is waiting for input (or has quit); returns the text since last call.
  waitForPrompt() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
      if (this.input || this.exited) this.wake()
    })
  }

  wake() {
    const ws = this.waiters.splice(0)
    if (!ws.length) return
    const text = tidy(this.buffer)
    this.buffer = ''
    for (const w of ws) w.resolve(text)
  }

  fail(err) {
    for (const w of this.waiters.splice(0)) w.reject(err)
  }

  sendLine(value) {
    const inp = this.input
    this.input = null
    this.send({ type: 'line', window: inp.window, value })
  }

  sendChar(value) {
    const inp = this.input
    this.input = null
    this.send({ type: 'char', window: inp.window, value })
  }
}

const ZERO_METRICS = {
  buffercharheight: 1, buffercharwidth: 1, buffermarginx: 0, buffermarginy: 0,
  graphicsmarginx: 0, graphicsmarginy: 0, gridcharheight: 1, gridcharwidth: 1,
  gridmarginx: 0, gridmarginy: 0, inspacingx: 0, inspacingy: 0, outspacingx: 0, outspacingy: 0,
}

// GlkOte content runs come either as objects {style, text} or as flat
// [style, text, style, text...] pairs.
function runsToText(runs) {
  if (!runs) return ''
  let out = ''
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    // Skip the echo of the player's own typed command (style "input").
    if (typeof r === 'string') { if (r !== 'input') out += runs[i + 1] ?? ''; i++ }
    else if (r && typeof r.text === 'string' && r.style !== 'input') out += r.text
  }
  return out
}

function tidy(text) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*>\s*$/gm, '') // stray prompt characters
    .trim()
}

export class Game {
  static async start(storyBytes, { saveStore = null } = {}) {
    const format = detectFormat(storyBytes)
    if (!format) throw new Error('This file is not a Glulx or Z-code story file.')
    const g = new Game()
    g.format = format
    g.dialog = new MemoryDialog(storyBytes, saveStore)
    await g.dialog.init()
    g.glkote = new HeadlessGlkOte()
    const factory = (await import(ENGINE_URLS[format])).default
    const vm = await factory()
    vm.start({ arguments: [STORY_PATH], Dialog: g.dialog, GlkOte: g.glkote })
    g.intro = await g.settle(await g.glkote.waitForPrompt())
    return g
  }

  get hasSave() { return this.dialog.hasAutosave() }
  get exited() { return this.glkote.exited }
  get status() { return this.glkote.status() }

  // Some games pause for a keypress ("[Press any key]"). The driver can't see
  // the screen, so keep pressing space and collect the text until we're back
  // at a normal command prompt.
  async settle(text) {
    let all = text
    for (let i = 0; i < 20 && this.glkote.input?.type === 'char'; i++) {
      this.glkote.sendChar(i < 10 ? ' ' : 'escape')
      const more = await this.glkote.waitForPrompt()
      if (more) all += '\n\n' + more
    }
    return all
  }

  // Commands run one at a time, even if a background autosave is in flight.
  send(command) {
    const run = (this.queue ?? Promise.resolve()).then(() => this.sendNow(command))
    this.queue = run.catch(() => {})
    return run
  }

  async sendNow(command) {
    if (this.exited) return { text: '[The game has ended.]', status: this.status }
    if (this.glkote.input?.type !== 'line') await this.settle('')
    this.glkote.sendLine(String(command).slice(0, 200))
    const text = await this.settle(await this.glkote.waitForPrompt())
    return { text: text || '(no response)', status: this.status }
  }

  // Quietly save into the single autosave slot. Returns true on success.
  async autosave() {
    if (this.exited) return false
    const { text } = await this.send('save')
    return /ok|saved|done/i.test(text) && !/fail/i.test(text)
  }

  // Restore the autosave slot (if there is one). Returns the game's response.
  async restore() {
    if (!this.hasSave) return null
    const { text } = await this.send('restore')
    return text
  }
}
