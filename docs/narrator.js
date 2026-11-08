// Premium narrator voice: OpenAI's steerable text-to-speech model, told to
// read like a British nature-documentary narrator. Falls back to the phone's
// built-in voice (Speaker) with no key, no signal, or any API error.
//
// Audio is fetched one chunk ahead of playback so there are no gaps, and
// plays through a single <audio> element (unlocked by a tap), which Android
// routes to the car like any other media.

import { chunkText } from './voice.js'

export const NARRATOR_MODEL = 'gpt-4o-mini-tts'
export const NARRATOR_VOICES = [
  { id: 'fable', label: 'Fable: British, warm (default)' },
  { id: 'onyx', label: 'Onyx: deep' },
  { id: 'ash', label: 'Ash: soft-spoken' },
  { id: 'ballad', label: 'Ballad: expressive' },
  { id: 'sage', label: 'Sage: calm' },
  { id: 'cedar', label: 'Cedar: natural' },
]
// Roughly what OpenAI charges for this model per minute of audio.
const USD_PER_MINUTE = 0.015

export const NARRATOR_STYLE = `Voice: a seasoned British nature-documentary narrator. Warm, low and unhurried, with a sense of hushed wonder.
Accent: crisp, educated British English.
Tone: intimate and quietly reverent, as if careful not to disturb what is being observed; gentle curiosity with a hint of dry wit.
Pacing: measured, with natural pauses between sentences; slow down slightly for dramatic or mysterious moments.
Read the text exactly as written. Do not add or change any words.`

// A fraction of a second of silence, used to unlock audio playback on a tap.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA='

export class Narrator {
  constructor({ fallback, getKey, getVoice, onCost = () => {}, log = () => {} }) {
    this.fallback = fallback
    this.getKey = getKey
    this.getVoice = getVoice
    this.onCost = onCost
    this.log = log
    this.generation = 0
    this.controller = null
    this.audio = typeof Audio === 'function' ? new Audio() : null
    this.failedUntil = 0
  }

  get rate() { return this.fallback.rate }
  set rate(v) { this.fallback.rate = v }
  get premium() { return !!this.getKey() && !!this.audio }

  unlock() {
    this.fallback.unlock()
    if (!this.audio) return
    this.audio.src = SILENCE
    this.audio.play().catch(() => {})
  }

  stop() {
    this.generation++
    this.controller?.abort()
    this.controller = null
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src') }
    this.fallback.stop()
  }

  async say(text) {
    if (!text?.trim()) return
    this.stop()
    const gen = this.generation
    // After an API failure, use the phone voice for a minute before retrying.
    if (!this.premium || Date.now() < this.failedUntil) return this.fallback.say(text)

    const chunks = planChunks(text)
    this.controller = new AbortController()
    const signal = this.controller.signal
    const fetchChunk = (i) => this.synthesize(chunks[i], signal)
    let next = fetchChunk(0)
    for (let i = 0; i < chunks.length; i++) {
      let blob
      try {
        blob = await next
      } catch (err) {
        if (gen !== this.generation) return
        this.log(`Narrator voice unavailable (${err.message}); using the phone voice.`)
        this.failedUntil = Date.now() + 60000
        return this.fallback.say(chunks.slice(i).join(' '))
      }
      if (gen !== this.generation) return
      if (i + 1 < chunks.length) next = fetchChunk(i + 1)
      await this.play(blob, gen)
      if (gen !== this.generation) return
    }
  }

  async synthesize(input, signal) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.getKey()}` },
      body: JSON.stringify({
        model: NARRATOR_MODEL,
        voice: this.getVoice() || 'fable',
        input,
        instructions: NARRATOR_STYLE,
        response_format: 'mp3',
      }),
    })
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try { detail += `: ${(await res.json()).error?.message ?? ''}` } catch {}
      throw new Error(detail)
    }
    return res.blob()
  }

  play(blob, gen) {
    return new Promise((resolve) => {
      const a = this.audio
      const url = URL.createObjectURL(blob)
      let timer
      const done = () => {
        clearTimeout(timer)
        a.onended = a.onerror = a.onpause = a.onloadedmetadata = null
        URL.revokeObjectURL(url)
        resolve()
      }
      a.onloadedmetadata = () => {
        if (Number.isFinite(a.duration)) {
          this.onCost((a.duration / 60) * USD_PER_MINUTE)
          // Watchdog in case 'ended' never fires.
          timer = setTimeout(done, (a.duration / (a.playbackRate || 1)) * 1000 + 4000)
        }
      }
      a.onended = done
      a.onerror = done
      a.onpause = () => { if (gen !== this.generation) done() }
      a.src = url
      a.playbackRate = this.rate
      a.play().catch(done)
    })
  }
}

// Short first chunk so the voice starts quickly, then longer chunks.
export function planChunks(text) {
  const small = chunkText(text, 300)
  const out = small.length ? [small[0]] : []
  let cur = ''
  for (const c of small.slice(1)) {
    if (cur && (cur + ' ' + c).length > 900) { out.push(cur); cur = c } else cur = cur ? `${cur} ${c}` : c
  }
  if (cur) out.push(cur)
  return out
}
