import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { makeZip } from './zipfixture.mjs'
import { extractStory, listZip } from '../docs/unzip.js'
import { detectFormat } from '../docs/engine.js'

const story = new Uint8Array(await readFile(new URL('../docs/games/lantern-hill.ulx', import.meta.url)))

test('passes a bare story file through', async () => {
  assert.equal(await extractStory(story), story)
})

test('finds the story file inside a zip', async () => {
  const zip = makeZip([
    ['Game/ReadMe.txt', Buffer.from('hello'.repeat(50))],
    ['Game/Cover.png', Buffer.alloc(2000, 7), false],
    ['Game/Dr Ludwig and the Devil.gblorb', story],
  ])
  assert.equal(listZip(zip).length, 3)
  const out = await extractStory(zip)
  assert.deepEqual(out, story)
  assert.equal(detectFormat(out), 'glulx')
})

test('unwraps a web-player build that embeds the story as base64', async () => {
  const js = `$(document).ready(function(){ GiLoad.load_run(null, '${Buffer.from(story).toString('base64')}', 'base64'); });`
  const zip = makeZip([['Release/play.html', Buffer.from('<html>')], ['Release/interpreter/story.gblorb.js', Buffer.from(js)]])
  assert.deepEqual(await extractStory(zip), story)
})

test('rejects a zip with no story file', async () => {
  await assert.rejects(extractStory(makeZip([['a.txt', Buffer.from('nope')]])), /No playable story file/)
})
