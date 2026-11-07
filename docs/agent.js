// The co-pilot: turns what the driver says into game commands with Claude,
// plays them, and returns what should be spoken aloud.
//
// Each turn is a fresh request: a frozen system prompt, then the recent
// transcript as one text block per past turn (append-only, so prompt caching
// keeps working), then the new utterance. Nothing earlier is ever edited
// in place, which keeps cache hits high and costs around a dollar a day.
//
// If Claude can't be reached (no signal, bad key, refusal), the turn falls
// back to "direct mode": the driver's words go straight to the game's parser.

export const MODEL = 'claude-haiku-5-5'
// Claude Haiku 5.5 list prices, USD per million tokens (prompts up to 100K tokens).
const PRICE = { input: 0.10, cacheWrite: 0.125, cacheRead: 0.01, output: 0.50 }

const MAX_STEPS = 12          // model calls per driver turn
const KEEP_TURNS = 40         // turns kept after trimming
const TRIM_AT = 60            // trim only occasionally, so the cached prefix survives

export const SYSTEM_PROMPT = `You are the voice co-pilot for a driver on a long road trip. Together you are playing a parser-based interactive fiction game (a text adventure). The driver cannot look at a screen: they speak to you, and everything you write is turned into speech and played through the car speakers.

How a turn works
- You receive the recent transcript, the game's status line, and what the driver just said. Their words come from speech recognition, so expect mistakes such as homophones and dropped words, and interpret them charitably in the context of the game: "examine the which" next to a witch means the witch.
- To act in the game, call the game_command tool with one short parser command at a time, such as "north", "examine lantern", "take all", "ask guard about key" or "put can in car". Each call returns the game's response.
- When you are done acting, write the words to say aloud to the driver.

Playing on the driver's behalf
- Do what the driver asks, turning casual speech into proper commands. "Let's see what's in that box" becomes "open box", then "look in box" if needed.
- If the game doesn't understand a command, rephrase it and try again, up to about three tries, before telling the driver.
- Simple multi-step requests are fine: "go back to the office" means walking there room by room, and "grab everything" means "take all". Keep to what was asked. Don't explore, solve puzzles or make story choices on your own unless the driver hands you the wheel ("you play for a while", "figure it out"); then play sensibly for up to about eight commands and report what happened.
- Never send save, restore, restart, quit or undo unless the driver clearly asks for exactly that. Don't use "again" or "g"; type the actual command instead. Progress is saved automatically after every turn, so if they ask about saving, tell them it's handled.
- If the driver asks for a hint, give a gentle nudge first, and spell out the answer only if they ask again.

What to say aloud
- New story text matters most. Read the game's prose for new places, events and dialogue word for word, exactly as the author wrote it; don't paraphrase or shorten it. You may drop parser clutter such as bracketed notices, but mention score changes briefly.
- Keep routine results brief: "Got it. You're carrying the key and the fuel can."
- After several moves, read the important text (especially where the driver ended up) and summarize the steps in between.
- If the driver asks you to repeat, restate or clarify ("what was that?", "where am I?", "what can I do here?", "what am I carrying?"), answer from the transcript, and use "look" or "inventory" only if the transcript doesn't cover it.
- Write plain spoken English only: no markdown, bullet points, symbols, emoji, headings or ASCII art. Don't read the status line unless asked.
- Keep your own remarks short, since the driver is on the road, and don't end every reply with a question.
- If what the driver said clearly wasn't meant for you (talking to a passenger, singing along, a phone call, navigation chatter), call no tools and reply with exactly: [silent]`

export const GAME_TOOL = {
  name: 'game_command',
  description: 'Type one command into the game and get the game\'s response. Use standard parser commands: compass directions, "look", "inventory", "examine X", "take X", "open X", "talk to X", "ask X about Y". One command per call.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'A single parser command, for example "open the red door".' },
    },
    required: ['command'],
    additionalProperties: false,
  },
}

export class CoPilot {
  constructor({ client, game, title = 'the game', log = () => {} }) {
    this.client = client
    this.game = game
    this.title = title
    this.log = log
    this.turns = [] // rendered transcript blocks, oldest first
    this.usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
    this.offlineNotice = false
  }

  get costUSD() {
    const u = this.usage
    return (u.input * PRICE.input + u.cacheWrite * PRICE.cacheWrite + u.cacheRead * PRICE.cacheRead + u.output * PRICE.output) / 1e6
  }

  // Record text the driver heard without a model call (intro, restore, etc.).
  note(label, text) {
    this.push(`${label}:\n${text}`)
  }

  push(block) {
    this.turns.push(block)
    if (this.turns.length > TRIM_AT) this.turns = [this.turns[0], ...this.turns.slice(-(KEEP_TURNS - 1))]
  }

  // Handle one utterance. Returns { speak, commands, mode }.
  async handle(utterance) {
    if (this.client) {
      try {
        const r = await this.agentTurn(utterance)
        this.offlineNotice = false
        return r
      } catch (err) {
        this.log(`Claude unavailable, using direct mode: ${err?.message ?? err}`)
        const r = await this.directTurn(utterance)
        if (!this.offlineNotice) {
          this.offlineNotice = true
          r.speak = `${describeError(err)} I'll pass your words straight to the game for now. ${r.speak}`
        }
        return r
      }
    }
    return this.directTurn(utterance)
  }

  async agentTurn(utterance) {
    const content = [
      { type: 'text', text: `Game: ${this.title}. Transcript so far follows, oldest first.` },
      ...this.turns.map((t) => ({ type: 'text', text: t })),
      { type: 'text', text: `Status line: ${this.game.status || '(none)'}\n\nThe driver just said: "${utterance}"` },
    ]
    const messages = [{ role: 'user', content }]
    const commands = []
    let speak = ''

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: [GAME_TOOL],
        messages,
      })
      this.addUsage(response.usage)

      if (response.stop_reason === 'refusal') throw new Error('The model declined this turn.')

      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim()
      const calls = response.content.filter((b) => b.type === 'tool_use')
      if (!calls.length || response.stop_reason !== 'tool_use') {
        speak = text
        break
      }

      messages.push({ role: 'assistant', content: response.content })
      const results = []
      for (const call of calls) {
        const command = String(call.input?.command ?? '').trim()
        let output
        if (!command) {
          output = 'Error: empty command.'
        } else {
          const r = await this.game.send(command)
          commands.push({ command, output: r.text })
          output = `${r.text}\n[status line: ${r.status || 'none'}]`
          this.log(`> ${command}\n${r.text}`)
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content: output })
      }
      messages.push({ role: 'user', content: results })
      if (step === MAX_STEPS - 1) speak = commands.at(-1)?.output ?? ''
    }

    if (/^\[silent\]$/i.test(speak.trim())) speak = ''
    speak = forSpeech(speak)
    this.push(renderTurn(utterance, commands, speak || '(stayed quiet)'))
    return { speak, commands, mode: 'agent' }
  }

  async directTurn(utterance) {
    const command = toCommand(utterance)
    const r = await this.game.send(command)
    const speak = forSpeech(r.text)
    this.push(renderTurn(utterance, [{ command, output: r.text }], speak))
    return { speak, commands: [{ command, output: r.text }], mode: 'direct' }
  }

  addUsage(u) {
    if (!u) return
    this.usage.input += u.input_tokens ?? 0
    this.usage.cacheWrite += u.cache_creation_input_tokens ?? 0
    this.usage.cacheRead += u.cache_read_input_tokens ?? 0
    this.usage.output += u.output_tokens ?? 0
  }
}

function renderTurn(utterance, commands, spoken) {
  const cmds = commands.map((c) => `> ${c.command}\n${c.output}`).join('\n\n')
  return `Driver said: "${utterance}"\n${cmds ? `${cmds}\n` : ''}You said aloud: ${spoken}`
}

function describeError(err) {
  const status = err?.status
  if (status === 401 || status === 403) return 'My API key was rejected, so check it in settings.'
  if (status === 429) return 'I am being rate limited.'
  if (status === 400 && /credit|billing|balance/i.test(err?.message ?? '')) return 'The API account is out of credit.'
  return 'I can\'t reach Claude right now, probably no signal.'
}

// Best-effort conversion of casual speech to a parser command, for direct mode.
export function toCommand(utterance) {
  let s = utterance.toLowerCase().trim().replace(/[.!?,]+$/g, '')
  s = s.replace(/^(ok(ay)?|so|um+|uh+|hey|alright)[, ]+/g, '')
  s = s.replace(/^(please |can you |could you |let'?s |let us |i want to |i'd like to |go ahead and |try to |i'll |we should )+/g, '')
  s = s.replace(/ please$/, '')
  const dirs = { 'go north': 'north', 'go south': 'south', 'go east': 'east', 'go west': 'west', 'go up': 'up', 'go down': 'down' }
  s = dirs[s] ?? s
  if (/^(look around|where am i)$/.test(s)) s = 'look'
  if (/^(what am i (carrying|holding)|what do i have|check (my )?inventory)$/.test(s)) s = 'inventory'
  return s || 'look'
}

// Make text pleasant for a speech engine: no markdown, no clutter.
export function forSpeech(text) {
  return String(text ?? '')
    .replace(/[*_#`~|]+/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\[Your score has (?:just )?gone (up|down) by (\w+) points?\.?\]/gi, 'Your score went $1 by $2.')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n\n')
    .trim()
}
