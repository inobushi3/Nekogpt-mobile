import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = join(root, 'public', 'hq-bg-q95')
const publicDir = join(root, 'public')
const outputs = [
  join(publicDir, 'connection-background-hq.webp'),
  // Compatibility with the currently deployed shell while Vercel switches builds.
  join(publicDir, 'connection-background-fixed.webp'),
  join(publicDir, 'connection-bg.webp'),
]

const parts = (await readdir(partsDir))
  .filter((name) => /^part-\d+\.txt$/.test(name))
  .sort()

if (parts.length !== 17) {
  throw new Error(`Expected 17 HQ background parts, found ${parts.length}`)
}

const base64 = (await Promise.all(
  parts.map((name) => readFile(join(partsDir, name), 'utf8'))
)).join('').replace(/\s+/g, '')

const image = Buffer.from(base64, 'base64')

if (
  image.length !== 203258 ||
  image.toString('ascii', 0, 4) !== 'RIFF' ||
  image.toString('ascii', 8, 12) !== 'WEBP'
) {
  throw new Error(`Assembled HQ background is invalid (${image.length} bytes)`)
}

await Promise.all(outputs.map((output) => writeFile(output, image)))
console.log(`Assembled HQ background aliases: ${image.length} bytes`)
