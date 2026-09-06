import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const distDir = 'dist';
const outputFile = 'deploy/nekogpt-single.html';
let html = await readFile(join(distDir, 'index.html'), 'utf8');

const localAssetPath = (url) => {
  const clean = String(url || '').split(/[?#]/, 1)[0].replace(/^\/+/, '');
  return join(distDir, clean);
};

const stylesheetPattern = /<link\b([^>]*?)rel=["']stylesheet["']([^>]*?)href=["']([^"']+)["']([^>]*)>/gi;
for (const match of [...html.matchAll(stylesheetPattern)]) {
  const [tag, , , href] = match;
  if (!href.startsWith('/assets/') && !href.startsWith('assets/')) continue;
  const css = await readFile(localAssetPath(href), 'utf8');
  html = html.replace(tag, `<style data-nekogpt-bundled-css>\n${css}\n</style>`);
}

const moduleScriptPattern = /<script\b([^>]*?)type=["']module["']([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi;
for (const match of [...html.matchAll(moduleScriptPattern)]) {
  const [tag, , , src] = match;
  if (!src.startsWith('/assets/') && !src.startsWith('assets/')) continue;
  let js = await readFile(localAssetPath(src), 'utf8');
  js = js.replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, `<script type="module" data-nekogpt-bundled-js>\n${js}\n</script>`);
}

if (/\/(?:assets)\//.test(html)) {
  throw new Error('The single-file build still contains local /assets/ references.');
}

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, html, 'utf8');
console.log(`Wrote ${outputFile} (${Buffer.byteLength(html)} bytes)`);
