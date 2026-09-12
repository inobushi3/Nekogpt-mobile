import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const lockedFiles = {
  'src/components/ConnectionGate.tsx': 'f37f71829e451d8b73833043863f0d280a11d71a',
  'src/connection-background.ts': 'e1ffe324b1f2df2e07f49e3b13cf9cb8a418584b',
  'src/background-static.css': '0f5307a8d44242872b882137149497be57d8525d',
  'src/connection-gate-polish.css': '75c839e3942f7f08ccfe5fb851e0ce53bbe944bd',
  'src/connection-code-strip.css': 'c8b714e33d93c3c6ec570e223f83385170c1ca86',
  'src/connection-status-hide.css': '3df3a653bbf6c4b59c8cc1cd6132ec1c71ce4687',
  'src/connection-settings-round.css': '9de88702c9d36dc0d6b602a5cda88fe1b210e261',
  'src/connection-options-panel.css': '0c14c780a2d596dd3e33a7729b910779e880ef67',
  'src/connection-card-transparent.css': '76b6ce61603e6bf09e5d9c7233f989190ab40e28',
};

function gitBlobSha(content) {
  const body = Buffer.from(content);
  return createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`))
    .update(body)
    .digest('hex');
}

function normalize(text) {
  return text.replace(/\r\n/g, '\n').trimEnd();
}

const failures = [];

for (const [path, expected] of Object.entries(lockedFiles)) {
  const content = readFileSync(path);
  const actual = gitBlobSha(content);
  if (actual !== expected) {
    failures.push(`${path}\n  expected ${expected}\n  actual   ${actual}`);
  }
}

const styles = readFileSync('src/styles.css', 'utf8');
const companionMarker = '\n.companion-screen {';
const companionStart = styles.indexOf(companionMarker);
const baselineStyles = readFileSync('scripts/connection-styles-baseline.css', 'utf8');

if (companionStart < 0) {
  failures.push('src/styles.css no longer contains the expected .companion-screen boundary');
} else {
  const connectionBase = styles.slice(0, companionStart);
  if (normalize(connectionBase) !== normalize(baselineStyles)) {
    failures.push('the locked connection/global base section at the top of src/styles.css changed');
  }
}

const main = readFileSync('src/main.tsx', 'utf8');
const protectedImports = [
  "import './connection-gate-polish.css';",
  "import './background-static.css';",
  "import './connection-code-strip.css';",
  "import './connection-status-hide.css';",
  "import './connection-settings-round.css';",
  "import './connection-options-panel.css';",
  "import './connection-card-transparent.css';",
];

for (const item of protectedImports) {
  if (!main.includes(item)) failures.push(`missing protected import in src/main.tsx: ${item}`);
}

const lastConnectionImport = main.lastIndexOf("import './connection-card-transparent.css';");
const firstExecutableLine = main.indexOf("\nif ('serviceWorker' in navigator");
if (lastConnectionImport < 0 || firstExecutableLine < 0 || lastConnectionImport > firstExecutableLine) {
  failures.push('connection stylesheet import order in src/main.tsx changed unexpectedly');
}

if (failures.length) {
  console.error('\nCONNECTION PAGE LOCK FAILED\n');
  console.error('The connection/home page is frozen. Do not modify it while working on the companion/chat page.');
  console.error('Put new companion/chat styling under .companion-screen instead of changing shared/global connection styles.');
  console.error('If this was an intentional connection-page edit, manually verify the page first, then update the lock.\n');
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log('Connection page lock OK.');
