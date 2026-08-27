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
 * The mirror never lands on AutomationProjects itself. That branch is shared
 * company code, so each sync cuts its own camelCase branch off it, pushes there,
 * and prints a link to raise the PR by hand.
 *
 * Usage:
 *   node scripts/sync-to-platform.js --dry-run              # show what would change
 *   node scripts/sync-to-platform.js --branch paginationFix # sync + commit + push
 *   node scripts/sync-to-platform.js -b addMethodFix -m "message"
 *   node scripts/sync-to-platform.js -b someFix --no-push   # commit locally only
 *
 * Auth: AZURE_DEVOPS_CODE_PAT in .env (needs Code Read & Write; the older
 * AZURE_DEVOPS_PAT is Work Items only and will not work here).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE = path.resolve(__dirname, '..');
const TARGET_REPO = 'C:\\Users\\sabih.siddiqui\\Desktop\\Automation\\Cybersoft.Platform';
const PREFIX = 'Cybersoft.Platform.TestAutomation/ExpressPointDesktopApp';
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

// The mirror never lands on BRANCH itself. BRANCH is shared company code that
// other people build from, so every sync cuts its own branch off it and stops
// there — the PR is raised by hand after review.
const branchIndex = args.findIndex((a) => a === '--branch' || a === '-b');
const featureBranch = branchIndex !== -1 ? args[branchIndex + 1] : '';

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

// A branch name is required, and must be camelCase — no dashes, underscores or
// slashes — so the PR list stays readable: dashboardFix, addMethodFix.
if (!dryRun) {
  if (!featureBranch) {
    fail(
      'a branch name is required: --branch <camelCaseName> (e.g. paginationFix).\n' +
        `The mirror is never pushed to ${BRANCH} directly — it goes to a new branch off it, ` +
        'and you raise the PR.',
    );
  }
  if (!/^[a-z][A-Za-z0-9]*$/.test(featureBranch)) {
    fail(
      `branch "${featureBranch}" is not camelCase. Use letters and digits only, ` +
        'starting lowercase — e.g. paginationFix, addMethodFix. No dashes or underscores.',
    );
  }
  if (featureBranch === BRANCH) {
    fail(`refusing to push to ${BRANCH} directly — pick a new branch name.`);
  }
}

// Start from an up-to-date BRANCH so the new branch carries only this sync's work.
if (!dryRun) {
  const authFetch = `https://anything:${pat}@${REMOTE_PATH}`;
  git(TARGET_REPO, ['fetch', authFetch, BRANCH], true);
  const base = git(TARGET_REPO, ['rev-parse', 'FETCH_HEAD'], true) || BRANCH;
  git(TARGET_REPO, ['checkout', '-B', featureBranch, base]);
  console.log(`Branched ${featureBranch} off ${BRANCH} (${base.slice(0, 7)}).`);
}

// --- work out the file set -------------------------------------------------

// Tracked files only: this is the gitignore filter that keeps .env out.
// Read the index with modes so gitlinks (mode 160000, i.e. submodules) can be
// dropped — they are directories on disk, so copying them byte-for-byte throws
// EISDIR, and a submodule pointer means nothing in a plain-folder mirror anyway.
let sourceFiles = [];
const submodules = [];
for (const line of git(SOURCE, ['ls-files', '--stage']).split('\n')) {
  if (!line.trim()) continue;
  const mode = line.slice(0, 6);
  const file = line.slice(line.indexOf('\t') + 1);
  if (mode === '160000') submodules.push(file);
  else sourceFiles.push(file);
}
if (submodules.length) {
  console.log(`Skipping ${submodules.length} submodule(s): ${submodules.join(', ')}`);
}

// Files that live in this repo but have no business in the shared monorepo. The
// mirror is meant to carry the K12 automation suite; freshdesk-notify.js is a
// RingCentral notifier whose real home is the FO-SprintBurnDown repo, and the copy
// here is dead — it is paused and nothing runs it. Syncing edits to a dead file into
// a repo other teams read is noise.
//
// Excluded paths are left ALONE at the target: not copied over, and not treated as
// stale either. Dropping them from the source set without also dropping them from the
// removal candidates would silently delete them from the shared repo on the next sync,
// which is a much bigger action than "stop mirroring this file".
const EXCLUDE = new Set([
  // Real home is the FO-SprintBurnDown repo; the copy here is paused and dead.
  'scripts/freshdesk-notify.js',
  // Local Task Scheduler tooling for this machine, not shared test automation. The
  // .vbs hardcodes an absolute path under this user profile, and auto-rerun-latest.js
  // shells out to scripts/rerun-failed.js, which is gitignored and therefore absent
  // from the mirror - so both are broken by construction anywhere but here.
  'scripts/auto-rerun-latest.js',
  'scripts/auto-rerun-hidden.vbs',
]);

if (EXCLUDE.size) {
  const dropped = sourceFiles.filter((f) => EXCLUDE.has(f));
  if (dropped.length) console.log(`Not mirrored (excluded): ${dropped.join(', ')}`);
}
sourceFiles = sourceFiles.filter((f) => !EXCLUDE.has(f));

const targetFiles = git(TARGET_REPO, ['ls-files', PREFIX])
  .split('\n')
  .filter(Boolean)
  .map((f) => f.slice(PREFIX.length + 1))
  .filter((f) => !EXCLUDE.has(f));

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

// --force is required, not sloppiness. This repo's .gitignore is itself one of
// the copied files, so git re-applies it inside the mirror and refuses paths
// that are legitimately tracked here — files added before a later ignore rule,
// or force-added at the time. The source repo's tracked set is the authority on
// what belongs in the mirror; nothing outside that set is ever copied, so there
// is no risk of sweeping in build output or secrets.
git(TARGET_REPO, ['add', '--all', '--force', PREFIX]);

const staged = git(TARGET_REPO, ['diff', '--cached', '--name-only', PREFIX], true);
if (!staged) {
  console.log('\nNothing staged after copy — already in sync.');
  process.exit(0);
}

git(TARGET_REPO, ['commit', '-m', commitMessage]);
console.log(`\nCommitted to ${featureBranch}: ${commitMessage}`);

if (noPush) {
  console.log('--no-push given; stopping before push.');
  process.exit(0);
}

// Push over an authenticated URL built at call time so the PAT is never written
// into .git/config where it would sit on disk in the shared checkout.
const authUrl = `https://anything:${pat}@${REMOTE_PATH}`;
try {
  execFileSync('git', ['-C', TARGET_REPO, 'push', authUrl, `HEAD:${featureBranch}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  const detail = (e.stderr || e.message || '').replace(pat, '<PAT>');
  fail(`push failed:\n${detail}`);
}

console.log(`\nPushed branch: ${featureBranch}`);
console.log('Open the PR here:');
console.log(
  `  https://dev.azure.com/Cybersoft-Technologies-Inc/Platform/_git/Cybersoft.Platform/` +
    `pullrequestcreate?sourceRef=${featureBranch}&targetRef=${BRANCH}`,
);

// Leave the shared checkout back on BRANCH so the next sync starts clean and
// nobody finds it parked on a one-off branch.
git(TARGET_REPO, ['checkout', BRANCH], true);
