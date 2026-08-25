#!/usr/bin/env node
/**
 * Mirror this repo into the Cybersoft.Platform monorepo folder.
 *
 * The platform repo keeps each automation project as a plain folder
 * (ExpressPoint, K12Catering, SchoolCafe, SCTV), not a submodule, so this
 * copies files across and makes its own commit there. Histories stay separate
 * on purpose: the monorepo sees one clean commit per sync instead of this
 * repo's several hundred.
 *
 * Only files git already tracks here are copied, which is what keeps secrets
 * out: .env, .env.release, node_modules, test-results and CLAUDE.md are all
 * gitignored, so they can never reach the shared repo. Files deleted here are
 * deleted there too, so the folder is a true mirror rather than an append.
 *
 * Usage:
 *   node scripts/sync-to-platform.js --dry-run       # show what would change
 *   node scripts/sync-to-platform.js                 # sync + commit + push
 *   node scripts/sync-to-platform.js -m "message"    # custom commit message
 *   node scripts/sync-to-platform.js --no-push       # commit locally, don't push
 *
 * Auth: AZURE_DEVOPS_CODE_PAT in .env (needs Code Read & Write; the older
 * AZURE_DEVOPS_PAT is Work Items only and will not work here).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE = path.resolve(__dirname, '..');
const TARGET_REPO = 'C:\\Users\\sabih.siddiqui\\Desktop\\Automation\\Cybersoft.Platform';
const PREFIX = 'ExpressPointDesktopApp';
const BRANCH = 'AutomationProjects';
const REMOTE_PATH =
  'dev.azure.com/Cybersoft-Technologies-Inc/Platform/_git/Cybersoft.Platform';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noPush = args.includes('--no-push');
const msgIndex = args.findIndex((a) => a === '-m' || a === '--message');
const commitMessage =
  msgIndex !== -1 && args[msgIndex + 1]
    ? args[msgIndex + 1]
    : 'Update ExpressPoint Desktop automation';

function git(repo, gitArgs, allowFail = false) {
  try {
    return execFileSync('git', ['-C', repo, ...gitArgs], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (e) {
    if (allowFail) return '';
    console.error(`git ${gitArgs.join(' ')} failed:\n${e.stderr || e.message}`);
    process.exit(1);
  }
}

function readEnvValue(key) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(SOURCE, '.env'), 'utf8');
  } catch {
    return '';
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
  }
  return '';
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// --- preflight -------------------------------------------------------------

if (!fs.existsSync(TARGET_REPO)) {
  fail(`platform repo not found at ${TARGET_REPO}`);
}

const pat = readEnvValue('AZURE_DEVOPS_CODE_PAT');
if (!pat && !noPush && !dryRun) {
  fail('AZURE_DEVOPS_CODE_PAT not found in .env (needs Code Read & Write).');
}

// Refuse to run against a dirty platform checkout — committing someone else's
// half-finished work into a shared repo is not ours to do.
const targetDirty = git(TARGET_REPO, ['status', '--porcelain'], true)
  .split('\n')
  .filter((l) => l.trim() && !l.includes(PREFIX));
if (targetDirty.length) {
  console.error('Platform repo has uncommitted changes outside ' + PREFIX + ':');
  targetDirty.slice(0, 10).forEach((l) => console.error('  ' + l));
  fail('resolve those first — refusing to touch a dirty shared checkout.');
}

// The point of this mirror is "what I committed here shows up there", so a
// half-edited working tree must not leak into the shared repo. Tracked-file
// edits block; untracked scratch files are ignored since they are never copied.
const sourceDirty = git(SOURCE, ['status', '--porcelain', '--untracked-files=no'], true)
  .split('\n')
  .filter(Boolean);
if (sourceDirty.length && !args.includes('--allow-dirty')) {
  console.error('This repo has uncommitted changes:');
  sourceDirty.forEach((l) => console.error('  ' + l));
  fail(
    'commit them first so the mirror matches your history ' +
      '(or pass --allow-dirty to sync the working tree anyway).',
  );
}

const currentBranch = git(TARGET_REPO, ['branch', '--show-current']);
if (currentBranch !== BRANCH) {
  fail(
    `platform repo is on "${currentBranch}", expected "${BRANCH}". ` +
      `Switch it with: git -C "${TARGET_REPO}" checkout ${BRANCH}`,
  );
}

// --- work out the file set -------------------------------------------------

// Tracked files only: this is the gitignore filter that keeps .env out.
const sourceFiles = git(SOURCE, ['ls-files'])
  .split('\n')
  .filter(Boolean);

const targetFiles = git(TARGET_REPO, ['ls-files', PREFIX])
  .split('\n')
  .filter(Boolean)
  .map((f) => f.slice(PREFIX.length + 1));

const sourceSet = new Set(sourceFiles);
const stale = targetFiles.filter((f) => !sourceSet.has(f));

const added = [];
const changed = [];
for (const rel of sourceFiles) {
  const src = path.join(SOURCE, rel);
  const dest = path.join(TARGET_REPO, PREFIX, rel);
  if (!fs.existsSync(dest)) {
    added.push(rel);
  } else {
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dest);
    if (!a.equals(b)) changed.push(rel);
  }
}

console.log(`Source (this repo):  ${sourceFiles.length} tracked files`);
console.log(`Target (${PREFIX}): ${targetFiles.length} tracked files`);
console.log('');
console.log(`  new:     ${added.length}`);
console.log(`  changed: ${changed.length}`);
console.log(`  removed: ${stale.length}`);

const show = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label}:`);
  list.slice(0, 40).forEach((f) => console.log('  ' + f));
  if (list.length > 40) console.log(`  ... and ${list.length - 40} more`);
};
show('NEW', added);
show('CHANGED', changed);
show('REMOVED', stale);

if (!added.length && !changed.length && !stale.length) {
  console.log('\nAlready up to date — nothing to sync.');
  process.exit(0);
}

if (dryRun) {
  console.log('\n--- dry run, nothing written ---');
  process.exit(0);
}

// --- apply -----------------------------------------------------------------

for (const rel of stale) {
  fs.rmSync(path.join(TARGET_REPO, PREFIX, rel), { force: true });
}

for (const rel of sourceFiles) {
  const dest = path.join(TARGET_REPO, PREFIX, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(SOURCE, rel), dest);
}

git(TARGET_REPO, ['add', '--all', PREFIX]);

const staged = git(TARGET_REPO, ['diff', '--cached', '--name-only', PREFIX], true);
if (!staged) {
  console.log('\nNothing staged after copy — already in sync.');
  process.exit(0);
}

git(TARGET_REPO, ['commit', '-m', commitMessage]);
console.log(`\nCommitted to ${BRANCH}: ${commitMessage}`);

if (noPush) {
  console.log('--no-push given; stopping before push.');
  process.exit(0);
}

// Push over an authenticated URL built at call time so the PAT is never written
// into .git/config where it would sit on disk in the shared checkout.
const authUrl = `https://anything:${pat}@${REMOTE_PATH}`;
try {
  execFileSync('git', ['-C', TARGET_REPO, 'push', authUrl, `HEAD:${BRANCH}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  const detail = (e.stderr || e.message || '').replace(pat, '<PAT>');
  fail(`push failed:\n${detail}`);
}

console.log(`Pushed to ${REMOTE_PATH} (${BRANCH}).`);
