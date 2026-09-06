import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const distDir = 'dist';
const outputFile = 'deploy/nekogpt-single.html';
let html = await readFile(join(distDir, 'index.html'), 'utf8');

const localAssetPath = (url) => {
  const clean = String(url || '').split(/[?#]/, 1)[0].replace(/^\/+/, '');
  return join(distDir, clean);
};

for (const tag of [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0])) {
  if (!/\brel=["']stylesheet["']/i.test(tag)) continue;
  const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
  if (!href || (!href.startsWith('/assets/') && !href.startsWith('assets/'))) continue;
  const css = await readFile(localAssetPath(href), 'utf8');
  const replacement = `<style data-nekogpt-bundled-css>\n${css}\n</style>`;
  html = html.replace(tag, () => replacement);
}

for (const tag of [...html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/gi)].map((match) => match[0])) {
  if (!/\btype=["']module["']/i.test(tag)) continue;
  const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (!src || (!src.startsWith('/assets/') && !src.startsWith('assets/'))) continue;
  let js = await readFile(localAssetPath(src), 'utf8');
  js = js.replace(/<\/script/gi, '<\\/script');
  const replacement = `<script type="module" data-nekogpt-bundled-js>\n${js}\n</script>`;
  html = html.replace(tag, () => replacement);
}

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, html, 'utf8');
console.log(`Wrote ${outputFile} (${Buffer.byteLength(html)} bytes)`);
