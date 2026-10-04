import { crc32 } from 'node:zlib'

/**
 * A text chunk in a PNG (0.398): how a team card carries its team.
 *
 * A PNG is an 8-byte signature and then chunks -- length, type, data, CRC --
 * and a `tEXt` chunk is `keyword NUL text`, which every viewer ignores and
 * every copy keeps. The text is base64 of UTF-8 JSON, because tEXt is
 * Latin-1 and a teammate's name need not be. Written just before IEND.
 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** A card's data is small; anything larger is not ours and is not read. */
const MAX_TEXT_BYTES = 256 * 1024

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

export function isPng(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes.subarray(0, 8).equals(SIGNATURE)
}

/** The PNG with `text` under `keyword`, replacing one already there. */
export function withTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  if (!isPng(png)) throw new Error('That is not a PNG image.')
  const kept: Buffer[] = [SIGNATURE]
  let end: Buffer | undefined
  for (const found of chunksOf(png)) {
    if (found.type === 'IEND') {
      end = found.raw
      break
    }
    if (found.type === 'tEXt' && found.data.subarray(0, found.data.indexOf(0)).toString('latin1') === keyword) continue
    kept.push(found.raw)
  }
  if (end === undefined) throw new Error('That PNG image has no end.')
  const body = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'latin1')])
  return Buffer.concat([...kept, chunk('tEXt', body), end])
}

/** The text under `keyword`, or undefined when the image carries none (or is not a PNG). */
export function readTextChunk(png: Buffer, keyword: string): string | undefined {
  if (!isPng(png)) return undefined
  for (const found of chunksOf(png)) {
    if (found.type !== 'tEXt') continue
    const zero = found.data.indexOf(0)
    if (zero < 0 || found.data.subarray(0, zero).toString('latin1') !== keyword) continue
    const encoded = found.data.subarray(zero + 1).toString('latin1')
    if (encoded.length > MAX_TEXT_BYTES) return undefined
    return Buffer.from(encoded, 'base64').toString('utf8')
  }
  return undefined
}

function* chunksOf(png: Buffer): Generator<{ readonly type: string; readonly data: Buffer; readonly raw: Buffer }> {
  let at = 8
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at)
    const endOf = at + 12 + length
    if (endOf > png.length) return
    const type = png.subarray(at + 4, at + 8).toString('latin1')
    yield { type, data: png.subarray(at + 8, at + 8 + length), raw: png.subarray(at, endOf) }
    at = endOf
  }
}
