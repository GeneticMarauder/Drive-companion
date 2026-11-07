// Test helper: build a .zip in memory.
import { deflateRawSync, crc32 } from 'node:zlib'

// Build a zip in memory: files = [[name, bytes, deflate?]]
export function makeZip(files) {
  const local = [], central = []
  let offset = 0
  for (const [name, data, deflate = true] of files) {
    const nameB = Buffer.from(name)
    const body = deflate ? deflateRawSync(data) : Buffer.from(data)
    const crc = crc32(data)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8)
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameB.length, 26)
    local.push(h, nameB, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameB.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, nameB)
    offset += 30 + nameB.length + body.length
  }
  const cd = Buffer.concat(central)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10)
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...local, cd, e]))
}

