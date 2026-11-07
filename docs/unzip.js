// Minimal .zip reader (stored and deflate entries) using the browser's
// built-in DecompressionStream, plus a helper that finds the story file
// inside a game's zip download.

const STORY_EXT = /\.(gblorb|glb|ulx|zblorb|zlb|z[1-8])$/i
const WRAPPED_EXT = /\.(gblorb|ulx|zblorb|z[1-8])\.js$/i // Inform "release with interpreter" builds

export function isZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export function listZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Find the end-of-central-directory record (scan back over any comment).
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a valid zip file.')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const entries = []
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory.')
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    entries.push({ name, method, compSize, size, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export async function readEntry(bytes, entry) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lo = entry.localOffset
  if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('Corrupt zip entry.')
  const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true)
  const data = bytes.subarray(start, start + entry.compSize)
  if (entry.method === 0) return data.slice()
  if (entry.method !== 8) throw new Error(`Unsupported zip compression (method ${entry.method}).`)
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Pull the playable story file out of a game download (zip or not).
export async function extractStory(bytes) {
  if (!isZip(bytes)) return bytes
  const entries = listZip(bytes).filter((e) => !e.name.endsWith('/') && !/(^|\/)__MACOSX\//.test(e.name))
  const direct = entries.filter((e) => STORY_EXT.test(e.name)).sort((a, b) => b.size - a.size)
  if (direct.length) return readEntry(bytes, direct[0])
  // Fallback: a web-player build that embeds the story as base64 in a .js file.
  const wrapped = entries.filter((e) => WRAPPED_EXT.test(e.name)).sort((a, b) => b.size - a.size)
  if (wrapped.length) {
    const js = new TextDecoder().decode(await readEntry(bytes, wrapped[0]))
    const m = js.match(/["']([A-Za-z0-9+/=\s]{1000,})["']/)
    if (m) {
      const bin = atob(m[1].replace(/\s+/g, ''))
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
  }
  throw new Error('No playable story file found in that download.')
}
