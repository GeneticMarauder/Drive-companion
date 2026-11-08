import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planChunks, NARRATOR_STYLE } from '../docs/narrator.js'

test('first chunk is short so the voice starts fast; the rest are bigger', () => {
  const text = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} of a long room description.`).join(' ')
  const chunks = planChunks(text)
  assert.ok(chunks[0].length <= 300)
  assert.ok(chunks.slice(1).every((c) => c.length <= 900))
  assert.ok(chunks.length < 10, `${chunks.length} chunks`)
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text)
})

test('narrator style asks for a style, not a real person', () => {
  assert.match(NARRATOR_STYLE, /nature-documentary narrator/)
  assert.doesNotMatch(NARRATOR_STYLE, /attenborough/i)
})
