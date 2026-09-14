#!/usr/bin/env node
/**
 * Potli dev bootstrap.
 *
 * Installs frontend + backend dependencies, creates local .env files from the
 * checked-in examples, and applies the Postgres schema (db/) through the
 * backend's existing db:migrate / db:seed scripts. Idempotent: safe to re-run.
 *
 * Usage:
 *   node scripts/setup.mjs                 # deps + .env, then DB if DATABASE_URL is real
 *   node scripts/setup.mjs --ci            # clean install from package-lock.json
 *   node scripts/setup.mjs --only db --with-db
 *   node scripts/setup.mjs --force-env     # regenerate .env from .env.example
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';
const APPS = ['frontend', 'backend'];
const TARGETS = [...APPS, 'db'];
const MIN_NODE_MAJOR = 20;
const DATABASE_URL_PLACEHOLDER = /USER:PASSWORD@HOST/;
const USAGE = `Usage: node scripts/setup.mjs [options]

Options:
  --ci          install with "npm ci" (clean, lockfile-exact)
  --force-env   overwrite existing .env files from .env.example
  --with-db     require the database step to succeed
  --skip-db     skip the database step
  --only <list> comma-separated subset of: ${TARGETS.join(', ')}
  -h, --help    show this message`;

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);
const red = (t) => paint('31', t);

const results = [];

function record(target, status, detail) {
  results.push({ target, status, detail });
}

function step(target, message) {
  console.log(`${dim('->')} ${bold(target)} ${message}`);
}

function fail(message) {
  console.error(`${red('error')} ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { ci: false, forceEnv: false, withDb: false, skipDb: false, only: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ci') opts.ci = true;
    else if (arg === '--force-env') opts.forceEnv = true;
    else if (arg === '--with-db') opts.withDb = true;
    else if (arg === '--skip-db') opts.skipDb = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--only') {
      opts.only = String(argv[i + 1] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
      const unknown = opts.only.filter((value) => !TARGETS.includes(value));
      if (unknown.length > 0) fail(`--only received unknown target(s): ${unknown.join(', ')}`);
      if (opts.only.length === 0) fail('--only needs at least one of: ' + TARGETS.join(', '));
    } else {
      fail(`unknown option "${arg}"\n\n${USAGE}`);
    }
  }
  return opts;
}

// npm is a .cmd shim on Windows, so it always goes through a shell. The command
// is a single string (never an args array) to stay clear of DEP0190; every
// argument here is a literal, so there is nothing to escape.
function runNpm(args, cwd) {
  step(path.basename(cwd), `npm ${args.join(' ')}`);
  return spawnSync(`${NPM} ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true });
}

function preflight() {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    fail(`Node ${MIN_NODE_MAJOR}+ is required (running ${process.versions.node}).`);
  }
  const npm = spawnSync(`${NPM} --version`, { stdio: 'ignore', shell: true });
  if (npm.status !== 0) fail('npm was not found on PATH.');
  record('toolchain', 'ok', `node ${process.versions.node}, npm available`);
}

function installDeps(opts, apps) {
  for (const app of apps) {
    const dir = path.join(CODE_DIR, app);
    const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
    const useCi = opts.ci && hasLock;
    if (opts.ci && !hasLock) {
      step(app, 'no package-lock.json, falling back to npm install');
    }
    const result = runNpm([useCi ? 'ci' : 'install'], dir);
    if (result.status !== 0) {
      record(app, 'fail', `npm ${useCi ? 'ci' : 'install'} exited with ${result.status}`);
      return false;
    }
    record(app, 'ok', `dependencies installed${useCi ? ' (npm ci)' : ''}`);
  }
  return true;
}

function ensureEnv(opts, apps) {
  for (const app of apps) {
    const dir = path.join(CODE_DIR, app);
    const example = path.join(dir, '.env.example');
    const target = path.join(dir, '.env');
    if (!fs.existsSync(example)) {
      record(`${app}/.env`, 'skip', 'no .env.example in this app');
      continue;
    }
    if (fs.existsSync(target) && !opts.forceEnv) {
      record(`${app}/.env`, 'skip', 'already exists (kept; use --force-env to reset)');
      continue;
    }
    fs.copyFileSync(example, target);
    record(`${app}/.env`, 'ok', `created from .env.example${opts.forceEnv ? ' (overwritten)' : ''}`);
  }
}

// Locating DATABASE_URL is all setup does locally: a value that is present but
// wrong is handed to pg as-is, because Postgres reports the real reason far
// better than any local check could. Only "the template is still here" is
// decided locally, since that is unambiguous.
function inspectDatabaseUrl() {
  const file = path.join(CODE_DIR, 'backend', '.env');
  const rel = path.relative(CODE_DIR, file);
  if (!fs.existsSync(file)) return { state: 'missing-env', rel };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*DATABASE_URL\s*=/.test(line));
  if (index === -1) return { state: 'missing-key', rel };
  const raw = lines[index].replace(/^\s*DATABASE_URL\s*=\s*/, '').trim();
  const value = raw.replace(/^["']|["']$/g, '');
  const where = `${rel}:${index + 1}`;
  if (value === '') return { state: 'empty', rel, where };
  if (DATABASE_URL_PLACEHOLDER.test(value)) return { state: 'placeholder', rel, where };
  return { state: 'configured', rel, where, value };
}

function runDatabase(opts) {
  const backendDir = path.join(CODE_DIR, 'backend');
  const info = inspectDatabaseUrl();

  if (opts.skipDb) {
    record('db', 'skip', '--skip-db');
    return true;
  }

  if (info.state !== 'configured') {
    const [detail, hint] = {
      'missing-env': [`${info.rel} does not exist yet`, 'run "npm run setup" to create it'],
      'missing-key': [`${info.rel} has no DATABASE_URL line`, 'add one, see backend/.env.example'],
      empty: [`${info.where} is empty`, 'set it to your Neon connection string'],
      placeholder: [
        `${info.where} still holds the .env.example template`,
        'replace it with your Neon connection string',
      ],
    }[info.state];
    if (opts.withDb) {
      record('db', 'fail', detail);
      console.error(`${red('error')} ${detail}`);
      console.error(`   ${dim(`${hint}, then re-run this command`)}`);
      return false;
    }
    record('db', 'skip', `${detail} — ${hint}`);
    return true;
  }

  for (const script of ['db:migrate', 'db:seed']) {
    const result = runNpm(['run', script], backendDir);
    if (result.status !== 0) {
      const scheme = /^postgres(ql)?:\/\//.test(info.value)
        ? ''
        : ` (DATABASE_URL at ${info.where} does not start with postgresql://)`;
      record('db', 'fail', `npm run ${script} exited with ${result.status}${scheme}`);
      return false;
    }
  }
  record('db', 'ok', `schema applied and dev accounts seeded (${info.where})`);
  return true;
}

function printSummary() {
  const width = Math.max(...results.map((entry) => entry.target.length));
  console.log(`\n${bold('Setup summary')}`);
  for (const { target, status, detail } of results) {
    const label = status === 'ok' ? green('ok  ') : status === 'skip' ? yellow('skip') : red('fail');
    console.log(`  ${label} ${target.padEnd(width)}  ${detail}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const selected = opts.only ?? TARGETS;
  const apps = APPS.filter((app) => selected.includes(app));

  console.log(`${bold('Potli setup')} ${dim(CODE_DIR)}\n`);
  preflight();

  let ok = true;
  if (apps.length > 0) ok = installDeps(opts, apps) && ok;
  if (apps.length > 0) ensureEnv(opts, apps);
  if (selected.includes('db')) ok = runDatabase(opts) && ok;

  printSummary();
  if (!ok) {
    console.log(`\n${red('Setup failed.')} Fix the entries above and re-run.`);
    process.exit(1);
  }
  console.log(`\n${green('Ready.')} Start both apps with: ${bold('npm run dev')}  ${dim('(from this folder)')}`);
}

main();
