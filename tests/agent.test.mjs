import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Anthropic from '@anthropic-ai/sdk'
import { Game } from '../docs/engine.js'
import { CoPilot, toCommand, forSpeech } from '../docs/agent.js'

const story = new Uint8Array(await readFile(new URL('../docs/games/lantern-hill.ulx', import.meta.url)))

test('toCommand cleans casual speech', () => {
  assert.equal(toCommand("Let's go north."), 'north')
  assert.equal(toCommand('Okay, can you open the door please'), 'open the door')
  assert.equal(toCommand('What am I carrying?'), 'inventory')
})

test('forSpeech strips markdown and bracket notices', () => {
  assert.equal(forSpeech('**Hi** [Your score has gone up by one point.]'), 'Hi Your score went up by one.')
})

test('falls back to direct mode when Claude is unreachable', async () => {
  const game = await Game.start(story)
  const client = { messages: { create: async () => { throw new Error('fetch failed') } } }
  const pilot = new CoPilot({ client, game })
  const r = await pilot.handle("let's go north")
  assert.equal(r.mode, 'direct')
  assert.match(r.speak, /can't reach Claude/)
  assert.match(r.speak, /Hill Path/)
  const r2 = await pilot.handle('go north')
  assert.doesNotMatch(r2.speak, /can't reach Claude/, 'offline notice only once')
  assert.match(r2.speak, /Hilltop/)
})

// Live test: runs only when ANTHROPIC_API_KEY is set. Costs a fraction of a cent.
const live = process.env.ANTHROPIC_API_KEY ? test : test.skip
live('live: plays a few turns with Claude Haiku', { timeout: 180000 }, async () => {
  const game = await Game.start(story)
  const client = new Anthropic({ maxRetries: 1, timeout: 60000 })
  const pilot = new CoPilot({ client, game, title: 'Lantern Hill', log: (m) => console.log('   ', m.replace(/\n/g, '\n    ')) })
  pilot.note('Game opening (read aloud to the driver)', game.intro)

  const say = async (u) => {
    const t = Date.now()
    const r = await pilot.handle(u)
    console.log(`DRIVER: ${u}\nSPOKEN (${r.mode}, ${Date.now() - t} ms): ${r.speak}\n`)
    assert.equal(r.mode, 'agent')
    return r
  }

  let r = await say("let's head up toward that lantern on the hill")
  assert.match(game.status, /Hill Path|Hilltop/)
  r = await say('keep going up and check out the lantern')
  assert.ok(r.commands.some((c) => /lantern|lamp/.test(c.command)))
  r = await say('wait what did it say about the key')
  assert.match(r.speak, /key/i)
  r = await say('turn left at the next light babe, the exit is coming up')
  assert.equal(r.speak, '', 'ignores talk not meant for it')
  console.log(`Usage: ${JSON.stringify(pilot.usage)}  cost about $${pilot.costUSD.toFixed(4)}`)
})
