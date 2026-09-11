import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = join(root, 'public', 'hq-bg-q95')
const publicDir = join(root, 'public')
const outputs = [
  join(publicDir, 'connection-background-hq.webp'),
  // Compatibility aliases for older deployed shells.
  join(publicDir, 'connection-background-fixed.webp'),
  join(publicDir, 'connection-bg.webp'),
]

const EXPECTED_PART_COUNT = 17
const EXPECTED_IMAGE_BYTES = 203258
const EXPECTED_SHA256 = '985cc0a2878646ba927cb599b6e73b96b0faa8d38e4415b3a1305ceef593248d'

const parts = (await readdir(partsDir))
  .filter((name) => /^part-\d+\.txt$/.test(name))
  .sort()

if (parts.length !== EXPECTED_PART_COUNT) {
  throw new Error(`Expected ${EXPECTED_PART_COUNT} HQ background parts, found ${parts.length}`)
}

let base64 = (await Promise.all(
  parts.map((name) => readFile(join(partsDir, name), 'utf8'))
)).join('').replace(/\s+/g, '')

// Canonicalize a legacy one-character chunk typo that produced visible WebP
// corruption near the bottom of the image. This is intentionally idempotent:
// if the source chunk is already fixed, the correct `T` is kept unchanged.
const legacyTypoIndex = (13 * 16000) + 9333
if (base64[legacyTypoIndex] === 't' || base64[legacyTypoIndex] === 'T') {
  base64 = `${base64.slice(0, legacyTypoIndex)}T${base64.slice(legacyTypoIndex + 1)}`
}

const image = Buffer.from(base64, 'base64')
const sha256 = createHash('sha256').update(image).digest('hex')

if (
  image.length !== EXPECTED_IMAGE_BYTES ||
  image.toString('ascii', 0, 4) !== 'RIFF' ||
  image.toString('ascii', 8, 12) !== 'WEBP' ||
  sha256 !== EXPECTED_SHA256
) {
  throw new Error(`Assembled HQ background failed integrity check (${image.length} bytes, sha256=${sha256})`)
}

await Promise.all(outputs.map((output) => writeFile(output, image)))
console.log(`Assembled clean HQ background: ${image.length} bytes, sha256=${sha256}`)
