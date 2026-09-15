#!/usr/bin/env node
/**
 * Potli dev bootstrap.
 *
 * Installs dependencies for the launcher and each workspace, creates local .env
 * files from the checked-in examples, and applies the db workspace migrations
 * plus seed data. Idempotent: safe to re-run.
 *
 * Node runs this file directly through its native TypeScript support (types are
 * stripped at load), so there is no build step for dev tooling.
 *
 * Usage:
 *   node scripts/setup.ts                  # deps + .env, then DB if the URL is real
 *   node scripts/setup.ts --ci             # clean install from package-lock.json
 *   node scripts/setup.ts --only db --with-db
 *   node scripts/setup.ts --force-env      # regenerate .env from .env.example
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_URL_KEYS, inspectConnectionEnv, type ConnectionState } from './lib/env.ts';

const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';
/** Workspaces that own a package.json and get `npm install` run in them. */
const WORKSPACES = ['frontend', 'backend', 'db'];
const TARGETS = [...WORKSPACES];
const USAGE = `Usage: node scripts/setup.ts [options]

Options:
  --ci          install with "npm ci" (clean, lockfile-exact)
  --force-env   overwrite existing .env files from .env.example
  --with-db     require the database step to succeed
  --skip-db     skip the database step
  --only <list> comma-separated subset of: ${TARGETS.join(', ')}
  -h, --help    show this message`;

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string, text: string): string => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (t: string) => paint('1', t);
const dim = (t: string) => paint('2', t);
const green = (t: string) => paint('32', t);
const yellow = (t: string) => paint('33', t);
const red = (t: string) => paint('31', t);

type Status = 'ok' | 'skip' | 'fail';

interface Result {
  target: string;
  status: Status;
  detail: string;
}

interface Options {
  ci: boolean;
  forceEnv: boolean;
  withDb: boolean;
  skipDb: boolean;
  only: string[] | null;
  help: boolean;
}

const results: Result[] = [];

function record(target: string, status: Status, detail: string): void {
  results.push({ target, status, detail });
}

function step(target: string, message: string): void {
  console.log(`${dim('->')} ${bold(target)} ${message}`);
}

function fail(message: string): never {
  console.error(`${red('error')} ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { ci: false, forceEnv: false, withDb: false, skipDb: false, only: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ci') opts.ci = true;
    else if (arg === '--force-env') opts.forceEnv = true;
    else if (arg === '--with-db') opts.withDb = true;
    else if (arg === '--skip-db') opts.skipDb = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--only') {
      const values = String(argv[i + 1] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
      const unknown = values.filter((value) => !TARGETS.includes(value));
      if (unknown.length > 0) fail(`--only received unknown target(s): ${unknown.join(', ')}`);
      if (values.length === 0) fail(`--only needs at least one of: ${TARGETS.join(', ')}`);
      opts.only = values;
    } else {
      fail(`unknown option "${arg}"\n\n${USAGE}`);
    }
  }
  return opts;
}

// npm is a .cmd shim on Windows, so it always goes through a shell. The command
// is a single string (never an args array) to stay clear of DEP0190; every
// argument here is a literal, so there is nothing to escape.
function runNpm(args: string[], cwd: string): SpawnSyncReturns<Buffer> {
  step(path.basename(cwd), `npm ${args.join(' ')}`);
  return spawnSync(`${NPM} ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true });
}

function npmInstall(opts: Options, dir: string, label: string): boolean {
  const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
  const useCi = opts.ci && hasLock;
  if (opts.ci && !hasLock) step(label, 'no package-lock.json, falling back to npm install');
  const result = runNpm([useCi ? 'ci' : 'install'], dir);
  if (result.status !== 0) {
    record(label, 'fail', `npm ${useCi ? 'ci' : 'install'} exited with ${result.status}`);
    return false;
  }
  record(label, 'ok', `dependencies installed${useCi ? ' (npm ci)' : ''}`);
  return true;
}

function preflight(): void {
  const typeStripping = (process.features as { typescript?: string | false }).typescript;
  if (!typeStripping) {
    fail(
      `This project runs TypeScript directly, which needs Node with type stripping ` +
        `(Node 22.18+ or 24+); running ${process.versions.node}.`,
    );
  }
  const npm = spawnSync(`${NPM} --version`, { stdio: 'ignore', shell: true });
  if (npm.status !== 0) fail('npm was not found on PATH.');
  record('toolchain', 'ok', `node ${process.versions.node} (typescript: ${typeStripping}), npm available`);
}

function installDeps(opts: Options, workspaces: string[]): boolean {
  let ok = true;
  // The launcher and typecheck tooling live in the root package, so a full run
  // installs them too; a targeted --only run leaves the root alone.
  if (!opts.only) ok = npmInstall(opts, CODE_DIR, 'code') && ok;
  for (const workspace of workspaces) {
    ok = npmInstall(opts, path.join(CODE_DIR, workspace), workspace) && ok;
    if (!ok) return false;
  }
  return ok;
}

function ensureEnv(opts: Options, workspaces: string[]): void {
  for (const workspace of workspaces) {
    const dir = path.join(CODE_DIR, workspace);
    const example = path.join(dir, '.env.example');
    const target = path.join(dir, '.env');
    if (!fs.existsSync(example)) {
      record(`${workspace}/.env`, 'skip', 'no .env.example in this workspace');
      continue;
    }
    if (fs.existsSync(target) && !opts.forceEnv) {
      record(`${workspace}/.env`, 'skip', 'already exists (kept; use --force-env to reset)');
      continue;
    }
    fs.copyFileSync(example, target);
    record(`${workspace}/.env`, 'ok', `created from .env.example${opts.forceEnv ? ' (overwritten)' : ''}`);
  }
}

function runDatabase(opts: Options): boolean {
  const backendDir = path.join(CODE_DIR, 'backend');
  const dbDir = path.join(CODE_DIR, 'db');
  const info = inspectConnectionEnv(backendDir);
  const rel = path.relative(CODE_DIR, info.file);
  const where = info.where ? `${rel}:${info.where.split(':').pop()}` : rel;

  if (opts.skipDb) {
    record('db', 'skip', '--skip-db');
    return true;
  }

  if (info.state !== 'configured') {
    const messages: Record<Exclude<ConnectionState, 'configured'>, [detail: string, hint: string]> = {
      'missing-env': [`${rel} does not exist yet`, 'run "npm run setup" to create it'],
      'missing-key': [`${rel} has no ${DB_URL_KEYS.join(' or ')} line`, 'add one, see backend/.env.example'],      empty: [`${where} is empty`, `set ${info.key} to your Supabase connection string`],
      placeholder: [
        `${where} still holds the .env.example template`,
        `replace ${info.key} with your Supabase connection string (Dashboard -> Connect)`,
      ],
    };
    const [detail, hint] = messages[info.state];
    if (opts.withDb) {
      record('db', 'fail', detail);
      console.error(`${red('error')} ${detail}`);
      console.error(`   ${dim(`${hint}, then re-run this command`)}`);
      return false;
    }
    record('db', 'skip', `${detail} — ${hint}`);
    return true;
  }

  const value = info.value ?? '';
  const key = info.key ?? DB_URL_KEYS[0] ?? 'SUPABASE_DB_URL';
  for (const script of ['migrate', 'seed']) {
    const result = runNpm(['run', script], dbDir);
    if (result.status !== 0) {
      const scheme = /^postgres(ql)?:\/\//.test(value)
        ? ''
        : ` (${key} at ${where} does not start with postgresql://)`;
      record('db', 'fail', `npm run ${script} exited with ${result.status}${scheme}`);
      return false;
    }
  }
  record('db', 'ok', `Supabase migrations applied and dev accounts seeded (${where})`);
  return true;
}

function printSummary(): void {
  const width = Math.max(...results.map((entry) => entry.target.length));
  console.log(`\n${bold('Setup summary')}`);
  for (const { target, status, detail } of results) {
    const label = status === 'ok' ? green('ok  ') : status === 'skip' ? yellow('skip') : red('fail');
    console.log(`  ${label} ${target.padEnd(width)}  ${detail}`);
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const selected = opts.only ?? TARGETS;
  const workspaces = WORKSPACES.filter((workspace) => selected.includes(workspace));

  console.log(`${bold('Potli setup')} ${dim(CODE_DIR)}\n`);
  preflight();

  let ok = true;
  ok = installDeps(opts, workspaces) && ok;
  ensureEnv(opts, workspaces);
  if (selected.includes('db')) ok = runDatabase(opts) && ok;

  printSummary();
  if (!ok) {
    console.log(`\n${red('Setup failed.')} Fix the entries above and re-run.`);
    process.exit(1);
  }
  console.log(`\n${green('Ready.')} Start both apps with: ${bold('npm run dev')}  ${dim('(from this folder)')}`);
}

main();
