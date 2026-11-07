// Speech in and out, using the phone's built-in engines (free, no API usage).
//
// Speaker: speechSynthesis, fed in sentence-sized chunks because long
//   utterances get cut off on some Chrome builds.
// Listener: the Web Speech API's SpeechRecognition, one phrase at a time.
//   The loop is half-duplex (listen, then speak, then listen) so the
//   microphone never hears the car speakers reading the story.

export class Speaker {
  constructor() {
    this.synth = globalThis.speechSynthesis
    this.rate = 1
    this.voiceName = null
    this.generation = 0
  }

  get supported() { return !!this.synth }

  voices() {
    return (this.synth?.getVoices() ?? []).filter((v) => /^en/i.test(v.lang))
  }

  pickVoice() {
    const vs = this.voices()
    return vs.find((v) => v.name === this.voiceName)
      ?? vs.find((v) => /en-US/i.test(v.lang) && /google/i.test(v.name))
      ?? vs.find((v) => /en-US/i.test(v.lang))
      ?? vs[0] ?? null
  }

  // Must be called from a tap so mobile browsers allow audio later.
  unlock() {
    if (!this.synth) return
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    this.synth.speak(u)
  }

  stop() {
    this.generation++
    this.synth?.cancel()
  }

  // Speak text; resolves when finished or interrupted.
  async say(text) {
    if (!this.synth || !text?.trim()) return
    this.stop()
    const gen = this.generation
    for (const chunk of chunkText(text)) {
      if (gen !== this.generation) return
      await this.sayChunk(chunk, gen)
    }
  }

  sayChunk(chunk, gen) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(chunk)
      const voice = this.pickVoice()
      if (voice) { u.voice = voice; u.lang = voice.lang } else u.lang = 'en-US'
      u.rate = this.rate
      // Watchdog: some engines never fire onend.
      const ms = 4000 + (chunk.length / (14 * this.rate)) * 1000
      const timer = setTimeout(done, ms)
      function done() { clearTimeout(timer); resolve() }
      u.onend = done
      u.onerror = done
      if (gen !== this.generation) return done()
      this.synth.speak(u)
    })
  }
}

// Split into sentence-ish chunks of at most ~220 characters.
export function chunkText(text, max = 220) {
  const sentences = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?;:]+[.!?;:]*["')\]]*\s*/g) ?? []
  const chunks = []
  let cur = ''
  for (let s of sentences) {
    while (s.length > max) {
      const cut = s.lastIndexOf(' ', max) > 40 ? s.lastIndexOf(' ', max) : max
      if (cur) { chunks.push(cur.trim()); cur = '' }
      chunks.push(s.slice(0, cut).trim())
      s = s.slice(cut)
    }
    if ((cur + s).length > max && cur) { chunks.push(cur.trim()); cur = '' }
    cur += s
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

export class Listener {
  constructor() {
    this.Impl = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition
    this.current = null
    this.useLocal = false
  }

  get supported() { return !!this.Impl }

  stop() {
    try { this.current?.abort() } catch {}
    this.current = null
  }

  // Listen for one phrase. Resolves with the text, or null if nothing was said.
  // Rejects with an Error whose .code is 'not-allowed', 'network', 'audio-capture', etc.
  listenOnce({ onInterim } = {}) {
    return new Promise((resolve, reject) => {
      const rec = new this.Impl()
      this.current = rec
      rec.lang = 'en-US'
      rec.continuous = false
      rec.interimResults = true
      rec.maxAlternatives = 1
      if (this.useLocal && 'processLocally' in rec) rec.processLocally = true
      let finalText = ''
      let settled = false
      const finish = (fn, v) => { if (!settled) { settled = true; this.current = null; fn(v) } }

      rec.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        onInterim?.((finalText + ' ' + interim).trim())
      }
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return finish(resolve, null)
        if (e.error === 'network' && !this.useLocal && 'processLocally' in rec) this.useLocal = true
        finish(reject, Object.assign(new Error(`Speech recognition error: ${e.error}`), { code: e.error }))
      }
      rec.onend = () => finish(resolve, finalText.trim() || null)
      try { rec.start() } catch (err) { finish(reject, Object.assign(err, { code: 'start-failed' })) }
    })
  }
}
