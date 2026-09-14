#!/usr/bin/env node
/**
 * Potli dev launcher.
 *
 * Starts the backend (Express, :4000) and the frontend (Vite, :5173) together,
 * waits until each one answers, and tears both down on Ctrl+C or when either
 * process exits. Run "npm run setup" first.
 *
 * Usage:
 *   node scripts/dev.mjs
 *   node scripts/dev.mjs --only backend
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';
const DATABASE_URL_PLACEHOLDER = /USER:PASSWORD@HOST/;
const READY_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 4_000;
const USAGE = `Usage: node scripts/dev.mjs [options]

Options:
  --only <app>  start a single app: backend or frontend
  -h, --help    show this message`;

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);
const red = (t) => paint('31', t);
const cyan = (t) => paint('36', t);

const APPS = [
  {
    name: 'backend',
    dir: path.join(CODE_DIR, 'backend'),
    url: 'http://localhost:4000',
    probe: 'http://localhost:4000/api/v1/health',
  },
  {
    name: 'frontend',
    dir: path.join(CODE_DIR, 'frontend'),
    url: 'http://localhost:5173',
    probe: 'http://localhost:5173/',
  },
];

const children = [];
let openChildren = 0;
let shuttingDown = false;
let exitCode = 0;

function fail(message) {
  console.error(`${red('error')} ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { only: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--only') {
      const name = String(argv[i + 1] ?? '').trim();
      i += 1;
      if (!APPS.some((app) => app.name === name)) {
        fail(`--only expects one of: ${APPS.map((app) => app.name).join(', ')}`);
      }
      opts.only = name;
    } else {
      fail(`unknown option "${arg}"\n\n${USAGE}`);
    }
  }
  return opts;
}

function readEnvValue(dir, key) {
  const file = path.join(dir, '.env');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && match[1] === key) return match[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function preflight(apps) {
  const missing = [];
  for (const app of apps) {
    if (!fs.existsSync(path.join(app.dir, 'node_modules'))) missing.push(`${app.name}/node_modules`);
  }
  if (apps.some((app) => app.name === 'backend') && !fs.existsSync(path.join(CODE_DIR, 'backend', '.env'))) {
    missing.push('backend/.env');
  }
  if (missing.length > 0) {
    console.error(`${red('error')} missing: ${missing.join(', ')}`);
    console.error(`   run ${bold('npm run setup')} first ${dim('(from this folder)')}`);
    process.exit(1);
  }

  const url = readEnvValue(path.join(CODE_DIR, 'backend'), 'DATABASE_URL');
  if (apps.some((app) => app.name === 'backend') && (!url || DATABASE_URL_PLACEHOLDER.test(url))) {
    console.log(
      `${yellow('warn')}  backend/.env still has no real DATABASE_URL; the API starts but every DB call fails.`,
    );
    console.log(`      ${dim('fix it, then: npm run db:setup')}`);
  }
  if (!fs.existsSync(path.join(CODE_DIR, 'frontend', '.env'))) {
    console.log(`${yellow('warn')}  frontend/.env missing; the app falls back to http://localhost:4000.`);
  }
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WIN) {
    // npm.cmd runs under a shell, so kill the whole tree.
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, KILL_GRACE_MS).unref();
  } catch {
    child.kill('SIGTERM');
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (typeof code === 'number') exitCode = code;
  const live = children.filter((child) => child.exitCode === null && child.signalCode === null);
  for (const child of live) stopChild(child);
  if (live.length === 0) process.exit(exitCode);
  console.log(`\n${dim('stopping backend + frontend...')}`);
  setTimeout(() => process.exit(exitCode), KILL_GRACE_MS + 1_000).unref();
}

function startApp(app) {
  // Single command string + shell: needed for npm.cmd on Windows, and it keeps
  // the child pid the shell's, which is what the tree kill below targets.
  const child = spawn(`${NPM} run dev`, {
    cwd: app.dir,
    stdio: 'inherit',
    shell: true,
    detached: !IS_WIN,
  });
  children.push(child);
  openChildren += 1;
  console.log(`${cyan('start')} ${app.name.padEnd(8)} npm run dev ${dim(`(${app.url})`)}`);

  child.on('error', (err) => {
    console.error(`${red('error')} ${app.name} failed to start: ${err.message}`);
    exitCode = 1;
    shutdown(1);
  });

  child.on('close', (code, signal) => {
    openChildren -= 1;
    if (shuttingDown) {
      if (openChildren === 0) process.exit(exitCode);
      return;
    }
    const how = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`\n${red('error')} ${app.name} exited unexpectedly (${how}); stopping the other process.`);
    if (typeof code === 'number' && code !== 0) exitCode = code;
    else exitCode = 1;
    shutdown(exitCode);
  });
}

async function waitForReady(probe) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      await fetch(probe, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return false;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const apps = opts.only ? APPS.filter((app) => app.name === opts.only) : APPS;

  console.log(`${bold('Potli dev')} ${dim(CODE_DIR)}\n`);
  preflight(apps);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGHUP', () => shutdown(0));

  for (const app of apps) startApp(app);

  const ready = await Promise.all(apps.map((app) => waitForReady(app.probe)));
  if (shuttingDown) return;

  console.log('');
  apps.forEach((app, index) => {
    const label = ready[index] ? green('ready') : yellow('starting');
    console.log(`  ${label} ${app.name.padEnd(8)} ${app.url}`);
  });
  console.log(`\n${bold('Potli is running.')} ${dim('Press Ctrl+C to stop both.')}`);

  const notReady = apps.filter((_app, index) => !ready[index]);
  if (notReady.length > 0) {
    console.log(
      `${yellow('warn')}  no HTTP response yet from: ${notReady.map((app) => app.name).join(', ')} ${dim('(see output above)')}`,
    );
  }
}

main();
