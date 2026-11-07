import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Game, detectFormat } from '../docs/engine.js'

const story = new Uint8Array(await readFile(new URL('../docs/games/lantern-hill.ulx', import.meta.url)))

function memoryStore() {
  const m = new Map()
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v) }, m }
}

test('detects Glulx', () => {
  assert.equal(detectFormat(story), 'glulx')
})

test('plays Lantern Hill to the end', async () => {
  const g = await Game.start(story)
  assert.match(g.intro, /gas station/i)
  assert.match(g.status, /Gas Station/)
  const steps = [
    ['north', /Hill Path/],
    ['n', /Hilltop/],
    ['open lantern', /brass key/],
    ['s', /Hill Path/],
    ['s', /Forecourt/],
    ['unlock door with key', /unlock/i],
    ['open door', /open/i],
    ['east', /Station Office/],
    ['take can', /Taken/],
    ['w', /Forecourt/],
    ['put can in car', /pour the fuel/],
    ['drive', /engine roars[\s\S]*You have won/],
  ]
  for (const [cmd, re] of steps) {
    const { text } = await g.send(cmd)
    assert.match(text, re, `"${cmd}" -> ${text}`)
  }
})

test('autosave and restore across sessions', async () => {
  const store = memoryStore()
  const a = await Game.start(story, { saveStore: store })
  await a.send('north')
  assert.equal(await a.autosave(), true)
  assert.ok(store.m.size === 1, 'save written to store')

  const b = await Game.start(story, { saveStore: store })
  assert.equal(b.hasSave, true)
  const r = await b.restore()
  assert.match(r, /ok/i)
  const { text } = await b.send('look')
  assert.match(text, /Hill Path/)
})
