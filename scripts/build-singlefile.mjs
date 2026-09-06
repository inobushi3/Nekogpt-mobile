import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';

const distDir = 'dist';
const outputFile = 'deploy/nekogpt-single.html';
let html = await readFile(join(distDir, 'index.html'), 'utf8');

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const localAssetPath = (url) => {
  const clean = String(url || '').split(/[?#]/, 1)[0].replace(/^\/+/, '');
  return join(distDir, clean);
};

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

const publicDataUrls = new Map();
for (const file of await listFiles(distDir)) {
  const rel = relative(distDir, file).replaceAll('\\', '/');
  if (rel === 'index.html' || rel === 'sw.js' || rel === 'manifest.webmanifest' || rel.startsWith('assets/')) continue;
  const mime = MIME_TYPES[extname(rel).toLowerCase()];
  if (!mime) continue;
  const bytes = await readFile(file);
  publicDataUrls.set(`/${rel}`, `data:${mime};base64,${bytes.toString('base64')}`);
}

function inlinePublicAssets(source) {
  let output = source;
  for (const [url, dataUrl] of publicDataUrls) {
    if (output.includes(url)) output = output.split(url).join(dataUrl);
  }
  return output;
}

function escapeInlineScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

// Live2D's runtime loader normally creates <script src="..."> elements at
// runtime. In the standalone bundle those paths become data: URLs, which are
// not consistently executed by mobile browsers/WebViews. Preload both classic
// runtimes inline before the Vite module so window.Live2DCubismCore/window.Live2D
// already exist and the loader can return immediately.
const live2dPrelude = [];
for (const [name, rel] of [
  ['cubism-core', 'vendor/live2d/live2dcubismcore.min.js'],
  ['legacy-core', 'vendor/live2d/live2d.min.js'],
]) {
  let source = await readFile(join(distDir, rel), 'utf8');
  source = escapeInlineScript(source);
  live2dPrelude.push(`<script data-nekogpt-live2d-runtime="${name}">\n${source}\n</script>`);
}
const live2dPreludeHtml = live2dPrelude.join('\n');
let live2dPreludeInjected = false;

// The production HTML is intentionally standalone. It must not depend on
// root-level Vercel assets, a service worker, or another deployment URL.
html = html.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>/gi, '');

for (const tag of [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0])) {
  if (!/\brel=["']stylesheet["']/i.test(tag)) continue;
  const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
  if (!href || (!href.startsWith('/assets/') && !href.startsWith('assets/'))) continue;
  const css = inlinePublicAssets(await readFile(localAssetPath(href), 'utf8'));
  const replacement = `<style data-nekogpt-bundled-css>\n${css}\n</style>`;
  html = html.replace(tag, () => replacement);
}

for (const tag of [...html.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/gi)].map((match) => match[0])) {
  if (!/\btype=["']module["']/i.test(tag)) continue;
  const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (!src || (!src.startsWith('/assets/') && !src.startsWith('assets/'))) continue;
  let js = await readFile(localAssetPath(src), 'utf8');
  js = js.replace(/navigator\.serviceWorker\.register\(\s*(["'`])\/sw\.js\1\s*\)/g, 'Promise.resolve()');
  js = inlinePublicAssets(js);
  js = escapeInlineScript(js);
  const prelude = live2dPreludeInjected ? '' : `${live2dPreludeHtml}\n`;
  live2dPreludeInjected = true;
  const replacement = `${prelude}<script type="module" data-nekogpt-bundled-js>\n${js}\n</script>`;
  html = html.replace(tag, () => replacement);
}

html = inlinePublicAssets(html);

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, html, 'utf8');
console.log(`Wrote ${outputFile} (${Buffer.byteLength(html)} bytes)`);
