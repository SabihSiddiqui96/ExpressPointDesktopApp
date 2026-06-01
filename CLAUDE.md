# CLAUDE.md — QA Regression Automation (Portable TEMPLATE)

A reusable rule for running test automation in any test repo.

> **NEW REPO? START HERE.** Run the **`read claude`** command (see below) the
> first time you drop this file into a repo. It will read the project, ask you
> for the values it needs, and build the supporting files (helper script,
> permissions allowlist, env check). After that, `regression` and `fixtests`
> work the same in every repo.

**How to reuse this file:** copy it into a new repo, run `read claude` once,
answer the questions, and you're set. Everything under "WORKFLOW" is generic —
only the `CONFIG` block changes per project.

---

## CONFIG  ← filled in during `read claude` (or edit by hand)

```yaml
# --- Issue / Test tracker -------------------------------------------------
tracker: <<< azure_devops | jira | testrail >>>
tracker_base_url: "<<< e.g. https://dev.azure.com/<org>/<project> >>>"
# How to pull the test case ID out of a pasted URL.
id_extraction: "last_path_segment"   # last_path_segment | last_numeric | query_param:<name>
api_version: "7.0"             # ADO cloud = 7.0

# --- Auth env vars (NEVER hardcode secrets) -------------------------------
tracker_pat_env: "AZURE_DEVOPS_PAT"   # name of the token var in .env
pat_source: ".env"                    # read the token from .env, not shell env

# --- Where things live in THIS repo ---------------------------------------
generated_spec_dir: "<<< e.g. tests/tickets >>>"
site_map_file: "site-map.md"
helper_script: "scripts/ado-workitem.js"   # read-only fetch+validate helper

# --- Naming ---------------------------------------------------------------
spec_name_source: "ticket_tag_in_title"   # ticket_tag_in_title | test_case_id
ticket_tag_pattern: "<<< e.g. T-\\d+ >>>"  # regex for the tag in the title

# --- Run output -----------------------------------------------------------
capture_on_failure: ["screenshot", "trace", "video"]
site_map_update: "auto"        # auto | diff_first

# --- Optional integrations ------------------------------------------------
ringcentral_webhook_env: "<<< env var name, or leave blank if unused >>>"
```

---

## WORKFLOW

### The `read claude` command  (run ONCE per new repo)

When the user says **`read claude`**, onboard this repo. Goal: understand the
project, collect missing CONFIG values from the user, and create the supporting
files so `regression`/`fixtests` will work. Do this conversationally — ask for
what's missing, one thing at a time, and let the user paste answers.

#### Step A — Survey the repo

Inspect the project and report what you find:
- Test framework + runner (Playwright? config file?).
- Locator strategy: central xpath/locators file, `pages/` page objects, or
  inline selectors.
- Login flow: `global-setup.ts`, `utils/authStorage.ts`, `utils/*Flow.ts`,
  fixtures — however auth is done here.
- Folder layout for specs, base-URL helper, env handling.
- Does `.env` exist? Which keys are present?
- Does the helper script (`CONFIG.helper_script`) exist?
- Does `.claude/settings.local.json` exist, and what's allowlisted?

#### Step B — Ask the user for missing CONFIG values

For every `<<< ... >>>` placeholder still in CONFIG, ask the user. Typical asks:
- Tracker type + base URL (org/project).
- Where generated specs should go (`generated_spec_dir`).
- The ticket-tag regex used in test case titles (`ticket_tag_pattern`).
- The PAT env var name (default `AZURE_DEVOPS_PAT`).
- Whether a RingCentral (or other) webhook should be used.
Ask one cluster at a time; wait for the user to paste answers. Then write the
answers into the CONFIG block above.

#### Step C — Check / set up secrets (never accept secrets in chat)

- Confirm `.env` contains `CONFIG.tracker_pat_env`. If missing, tell the user to
  add `AZURE_DEVOPS_PAT=<token>` to `.env` themselves (do NOT take the token in
  chat). Remind: scope it read-only + Test Management Read; PATCH for the
  `[Automated]` tag needs Work Items **Write** too — tell the user so they can
  decide whether to enable title-tagging.
- Confirm `.env` is gitignored.

#### Step D — Create the read-only helper script (if missing)

If `CONFIG.helper_script` does not exist, create it. It must:
- Take a work item ID or full tracker URL as an argument.
- Read the PAT from `.env` (parse the file; do not rely on shell env).
- Do a **GET only** for fetch/validation; print `TYPE`, `TITLE`, `STATE`, and
  parsed steps for a Test Case.
- Print `WRONG_LINK:` when the type is not `Test Case`.
- (Optionally) support a separate, clearly-named write mode for the Step 11
  `[Automated]` PATCH — kept distinct so reads stay prompt-free.
See **TRACKER ADAPTERS** for the exact endpoints.

#### Step E — Create `.claude/settings.local.json` (if missing or incomplete)

Allowlist the safe, repetitive commands so runs don't prompt constantly, but
keep network/secret/destructive commands on "ask". Suggested baseline:
- **allow:** `npx playwright *`, `node *`, the helper script, `npm run:*`,
  `ls/cat/head/tail/grep/rg/find/echo/sed/awk`, `cp/mkdir`, `[ -f *`,
  `git status/diff/log`, `Read/Edit/Write`.
- **ask:** `curl:*`, `wget:*`, anything containing `PAT`/`AZURE_DEVOPS_PAT`/
  `base64`/`ENCRYPTION_KEY`/`ENCRYPTED_PASSWORD`, `rm:*`, `git push/commit`.
Tell the user to **restart Claude Code** after this file is created/changed.

#### Step F — Confirm ready

Summarize what was found, what you created, and what the user still needs to do
(e.g. add the PAT to `.env`, restart Claude Code). Then they can run
`regression` or `fixtests`.

---

### The `regression` command  (LOCAL — this repo)

This repo (ExpressPoint Desktop) runs **only locally** — there is no tracker URL
to fetch. When the user says **`regression`**, run the existing Playwright suite
locally in regression mode and report the results. The single input is **scope**:
failed-only, the full suite, or **full suite + fixtests** (run everything, then
auto-fix the failures in the same flow).

#### Step 0 — Force regression mode FIRST

Before anything else, force `TEST_MODE=regression` so the webhook fires:
```
node scripts/set-mode.js regression
```
Wait for the `✓ TEST_MODE set to "regression"` confirmation. (Same "ALWAYS
switch first" rule as the run commands — don't trust the current `.env` value.)

#### Step 1 — Ask scope: Full suite / Failed-only / Full suite + Fixtests

Ask the user **one thing** (three choices):

> *"Run **Full suite**, **Failed tests only**, or **Full suite + Fixtests**?"*

- **Full suite** → run everything: `npx playwright test`. Then Step 4 (report +
  hand off to `fixtests`).
- **Failed only** → re-run just the tests that failed in the **most recent run
  this session**. Source the failed titles from the last regression webhook
  block / Playwright output already in chat. If none is visible (fresh session),
  ask the user to paste the failed test names. Then run
  `npx playwright test -g "<title A>|<title B>|..."`.
- **Full suite + Fixtests** → run everything, **then automatically chain into
  the fix/re-run flow with no second prompt**. See **Step 5 — Full suite +
  Fixtests (chained)** below for the full sequence.

(Optional target still works like the run commands: a folder under `tests/`, a
`*.spec.ts` file, or a `-g "<title>"` — see "Target resolution".)

#### Step 2 — Run the suite

Run the resolved Playwright command. Because `TEST_MODE=regression`,
`reporter/webhook-reporter.ts` fires the start webhook and, on completion, the
`Passed / Failed / Total` summary with the failed-test list. Echo the same in
chat.

#### Step 2a — Understand page state before judging a failure

Reason about the app's state/business logic before calling something broken.
Capacity messages ("5/5 slots used"), empty states, role/permission states, and
disabled-by-design controls are NOT bugs.

#### Step 2b — Capacity-limit handling (verify without leaving damage)

If a control is unavailable because a limit is reached: pick one existing item,
**Edit it and capture all field values first**, delete it (frees a slot →
control appears), test the add/create flow, then **re-add the captured item** so
state is restored. Apply this pattern to any limit situation.

#### Step 3 — Capture on failure

Capture everything in `CONFIG.capture_on_failure` (screenshot, trace, video).

#### Step 4 — Report + hand off to `fixtests`

Report passed/failed per spec, with the failed-test list and totals. Then remind
the user they can run **`fixtests`** to triage and auto-fix the failed tests
(it sources the failed set from this run's output/webhook).

> Skip this step when the scope was **Full suite + Fixtests** — go straight to
> Step 5 instead of handing off.

#### Step 5 — Full suite + Fixtests (chained, only when that scope was picked)

This is the one-shot path: full run → completion webhook → **fixing
announcement webhook** → auto-fix one at a time → rerun webhook. The user picks
this once and does nothing else; you run the whole chain. Four webhook beats hit
the channel: **started → completed (+ failed list) → fixing announcement → re-run
results.**

1. **Run the full suite** exactly like Step 2 (`TEST_MODE=regression` already
   forced in Step 0). The reporter posts the **start** webhook and the
   **completion** webhook (`Passed / Failed / Total` + the "Failed Tests:" list).
   Record the **original suite total** (you'll need it as the rerun baseline) and
   the **list of failed test titles** from that completion output.
2. **If nothing failed** → you're done. Report all-green in chat; do not post the
   fixing announcement or do a re-run.
3. **If there are failures → post the fixing announcement webhook.** Run the
   standalone notifier (it posts to the same RingCentral webhook; gated to
   `TEST_MODE=regression` just like the reporter):
   ```powershell
   node scripts/notify.js fix-start --count <N> --tests "<title A>|<title B>|<title C>"
   ```
   This posts: `🔧 ExpressPoint Regression — N tests failed. Fix in progress…`
   followed by **`Failed tests:`** and each failed test as a bullet — so the
   channel sees the full failed list without you re-typing anything. (Keep the
   channel wording neutral — it should read like a normal QA fix pass, not
   reveal that fixing is automated.) Echo the same in chat.
4. **Auto-fix the failures** using the **`fixtests` Steps 2–4** logic (map each
   title to its spec, fix one at a time in isolation, real-bug guard — never fake
   a pass). The env is already **Regression** from Step 0, so no env question is
   asked here.
5. **Authoritative re-run** of all originally-failed tests together, in rerun
   mode, so the reporter posts the **merged** rerun webhook (same as `fixtests`
   Step 5, Regression branch). In PowerShell:
   ```powershell
   $env:RERUN_MODE = "1"
   $env:RERUN_BASELINE_TOTAL = "<original suite total from beat 1>"
   npx playwright test -g "<title A>|<title B>|<title C>"
   Remove-Item Env:RERUN_MODE, Env:RERUN_BASELINE_TOTAL
   ```
6. **Report at the end** using the `fixtests` Step 6 three-bucket summary
   (Fixed / Possible real bug / Couldn't diagnose) and the updated suite totals,
   and confirm the rerun webhook was posted.

---

### The `fixtests` command  (LOCAL — this repo)

When the user says **`fixtests`**, triage the failures from the most recent
**local** test run, auto-fix them one at a time, then re-run the previously
failed tests. This is the local analog of K12's pipeline `fixtests`/`rerun` —
**same structure and same webhook wording, but there is no build URL**: the
failed set comes from the last local run, and the webhook is posted by this
repo's `reporter/webhook-reporter.ts` (rerun mode), not from a pipeline.

#### Step 0 — Ask which env, then force-switch to it FIRST

`fixtests` runs in **either** env — ask the user up front:

> *"Run fixtests in **QA** or **Regression**?"*

Once they pick, **force `TEST_MODE` to match before doing anything else** — same
"ALWAYS switch first" rule as the run commands (see LOCAL RUN COMMANDS). Do NOT
trust whatever VS Code / `.env` is currently set to; the user may be in the
other mode.
- Picked **QA** → `node scripts/set-mode.js qa` (forces `TEST_MODE=qa`).
- Picked **Regression** → `node scripts/set-mode.js regression` (forces
  `TEST_MODE=regression`).

Wait for the `✓ TEST_MODE set to "<mode>"` confirmation, then continue. The
chosen env decides Step 5's webhook behavior: **Regression** posts the rerun
webhook; **QA** stays silent.

#### Step 1 — Get the failed tests from the last run (no build URL)

The failed test names come from whatever the most recent run already produced
**in this session**:
- **Regression run** → the RingCentral webhook message (also echoed in chat)
  lists the failed tests under "Failed Tests:" and shows `Passed / Failed /
  Total`.
- **QA run** → the Playwright `list` reporter output in the VS Code terminal /
  chat shows which specs failed.

Read the failed test titles **and the original suite Total** from that output.
If neither is present (e.g. a fresh session with no prior run visible), ask the
user to paste the webhook block or the failed test names + total.

#### Step 2 — Map each test name to its spec

Search the repo for the exact failed-test string inside a `test('...')` (or
`describe('...')`) title to locate the spec file. The webhook strips any
` [Automated]` tag and title-cases file names — match against the real
`test()`/`describe()` titles in `tests/**`.

#### Step 3 — Fix one at a time

Process failures **one by one** (not batched). For each:
1. Run only that test in isolation: `npx playwright test -g "<test name>"`.
2. **Passes now** → mark passing, move on.
3. **Fails** → diagnose with trace/screenshot/video + the site map, auto-fix
   using the same locator-discovery rules as `regression` (prefer role/text
   locators; persist only genuinely reusable ones). Re-run that single test
   until green. Apply the Step 6a/6b reasoning (understand page/business state;
   capacity-limit handling) here too.

#### Step 4 — Real-bug guard (do not fake a pass)

If a failure is an actual app defect (not a stale locator/test issue), do NOT
make the test pass — flag it. If undiagnosable, flag as needs-investigation.
Never make a test green by hiding a real problem.

#### Step 5 — Re-run the previously failed tests + post the updated webhook

After fixing, do an authoritative re-run of **all** the originally-failed tests
together. Behavior depends on the env chosen in **Step 0**:

- **QA** → just re-run, no webhook: `npx playwright test -g "<title A>|<title B>"`,
  then report in chat. Skip the rest of this step. (QA never fires the webhook.)
- **Regression** → post the K12-style webhooks. The webhook is fired by
  `reporter/webhook-reporter.ts` in **rerun mode**, driven by two env vars:

- `RERUN_MODE=1` → switches the start/finish messages to the
  "🔁 Re-running N previously failed test(s)" wording.
- `RERUN_BASELINE_TOTAL=<original suite total>` → lets the finish message report
  **merged** suite totals: `Total` stays the original total, `Failed` = whatever
  still fails, `Passed` = `Total − Failed`.

`TEST_MODE=regression` is already set from Step 0, so just run, passing the
failed titles and the original total. In PowerShell:

```powershell
$env:RERUN_MODE = "1"
$env:RERUN_BASELINE_TOTAL = "<original total, e.g. 55>"
npx playwright test -g "<title A>|<title B>|<title C>"
Remove-Item Env:RERUN_MODE, Env:RERUN_BASELINE_TOTAL
```

This posts:
- **Start:** "🔁 Re-running N previously failed test(s) on Sabih's local machine".
- **Finish:** "Re-ran N | Recovered R | Still F", then **Updated suite totals**
  `Passed | Failed | Total` (e.g. original `Passed 50 / Failed 5 / Total 55` →
  all fixed → `Passed 55 | Failed 0 | Total 55`).

> NOTE: don't re-run in plain regression mode WITHOUT `RERUN_MODE`, or the
> reporter posts the normal "Automation started / Completed" full-run messages
> with only the subset counts instead of the merged rerun summary.

#### Step 6 — Report at the end

List every test in three buckets:
- **Fixed** — what was wrong + the fix applied.
- **Possible real bug** — flagged for manual check, with the symptom.
- **Couldn't diagnose** — what was tried and where it got stuck.

Then state the updated totals (and confirm the rerun webhook was posted if in
regression).

---

## LOCAL RUN COMMANDS (this repo)

Two run "environments" exist, defined as VS Code tasks in `.vscode/tasks.json`.
Each just flips `TEST_MODE` in `.env` via `scripts/set-mode.js` BEFORE the
Playwright run — `TEST_MODE` controls whether `reporter/webhook-reporter.ts`
fires the webhook.

| Environment    | VS Code task        | Sets             | Webhook |
|----------------|---------------------|------------------|---------|
| QA             | Run Task: QA        | `TEST_MODE=qa`         | NO      |
| Regression     | Run Task: Regression| `TEST_MODE=regression` | YES     |

### ALWAYS switch to the matching mode FIRST (critical)

Whenever the user types **`Run QA test`** or **`Run regression test`**, the FIRST
action is to force `TEST_MODE` to match what they typed — **do not assume the
current mode is right.** The user may already be in the other mode (e.g. left in
regression, then types QA); always set it explicitly so the run can't fire (or
skip) the webhook against their intent. `scripts/set-mode.js` overwrites the
value in `.env`, so running it is idempotent and safe to do every time.

- Typed **QA** → run `node scripts/set-mode.js qa` (forces `TEST_MODE=qa`),
  even if it's already qa.
- Typed **regression** → run `node scripts/set-mode.js regression` (forces
  `TEST_MODE=regression`), even if it's already regression.

Only after the mode switch confirms (`✓ TEST_MODE set to "<mode>"`) do you run
Playwright. This is the "Run Task: QA" / "Run Task: Regression" step, done for
you automatically.

### Target resolution (shared by both commands)

Both commands take an optional target after the command and resolve it the same
way:
- **No target** → full suite: `npx playwright test`
- **A folder / feature name** (e.g. `bulk_sales`, matches a directory under
  `tests/`) → run everything in it: `npx playwright test tests/<name>`
- **A file name** (ends in `.spec.ts`, e.g. `system_settings.spec.ts`) → run
  just that file: `npx playwright test <file.spec.ts>`
- **A specific test title** → `npx playwright test -g "<title>"`

Test folders currently under `tests/`: `bulk_sales`, `close_service`,
`open_service`, `payments`, `sign_in_screen`, `special_account`,
`summary_sale`, `system_settings`, `tickets`, `transactions`.

### The `Run QA test` command

When the user says **`Run QA test`** (optionally + a target):
1. **Force QA mode first** — `node scripts/set-mode.js qa` (see "ALWAYS switch"
   above). `npm run mode:qa` is equivalent.
2. **Then run Playwright** on the resolved target (see "Target resolution").
3. Report pass/fail per spec. Because `TEST_MODE=qa`, **no webhook is sent** —
   failures are visible in the terminal/`list` output (that's the source for
   `fixtests`).

#### QA scope: Full suite / Failed-only / Full suite + Fixtests

Like `regression`, the `Run QA test` command accepts a **scope** (ask only when
no explicit target was given). Ask the user **one thing** (three choices):

> *"Run **Full suite**, **Failed tests only**, or **Full suite + Fixtests**?"*

- **Full suite** → run everything: `npx playwright test`. Then report (Step 3).
- **Failed only** → re-run just the tests that failed in the most recent run
  this session: `npx playwright test -g "<title A>|<title B>|..."`. If none is
  visible (fresh session), ask the user to paste the failed test names.
- **Full suite + Fixtests** → run everything, **then automatically chain into
  the fix/re-run flow with no second prompt**. See **QA Full suite + Fixtests
  (chained)** below.

#### QA Full suite + Fixtests (chained, only when that scope was picked)

This is the QA analog of the regression Step 5 chain, but **completely silent —
no webhooks, no `notify.js`**, because QA mode never posts. The user picks this
once and does nothing else; you run the whole chain and report only in chat.

1. **Run the full suite** (`npx playwright test`) with `TEST_MODE=qa` already
   forced in step 1. Record the **original suite total** (rerun baseline) and
   the **list of failed test titles** from the `list` reporter output.
2. **If nothing failed** → done. Report all-green in chat.
3. **If there are failures → auto-fix them** using the **`fixtests` Steps 2–4**
   logic (map each title to its spec, fix one at a time in isolation, real-bug
   guard — never fake a pass). The env is already **QA**, so no env question is
   asked here. **Do NOT post the fixing-announcement webhook** (`notify.js`) —
   that's regression-only.
4. **Authoritative re-run** of all originally-failed tests together. Because
   this is QA, **do NOT set `RERUN_MODE`/`RERUN_BASELINE_TOTAL`** (those only
   drive the regression webhook) — just re-run plainly:
   ```powershell
   npx playwright test -g "<title A>|<title B>|<title C>"
   ```
5. **Report at the end** using the `fixtests` Step 6 three-bucket summary
   (Fixed / Possible real bug / Couldn't diagnose) and the updated suite totals.
   No webhook is posted (QA stays silent).

### The `Run regression test` command

When the user says **`Run regression test`** (optionally + a target):
1. **Force regression mode first** — `node scripts/set-mode.js regression` (see
   "ALWAYS switch" above). `npm run mode:regression` is equivalent.
2. **Then run Playwright** on the resolved target (see "Target resolution").
3. Because `TEST_MODE=regression`, `reporter/webhook-reporter.ts` **fires the
   webhook**: a start message when the run begins and a `Passed / Failed /
   Total` summary (with the failed-test list) when it ends. Report the same in
   chat. That webhook/summary is the source `fixtests` reads failures from.

> Both commands run as a plain regression/qa run — do NOT set `RERUN_MODE` here.
> `RERUN_MODE` is only for the `fixtests` re-run step.

---

## SITE MAP

`CONFIG.site_map_file` is Claude's memorized model of the app. **Read first**,
**update last**. Suggested per-page structure:
```
## Page: <name>
- URL: <url>
- Tabs: [tab1, tab2, ...]
- Key elements: <buttons, fields, tooltips, titles>
- Notes: <quirks / recently changed>
```
Create it by recording observations on the first run if absent.

---

## TRACKER ADAPTERS

Only the tracker named in `CONFIG.tracker` is used.

### azure_devops  (implemented)

- Cloud, `api-version = CONFIG.api_version` (7.0).
- Auth: HTTP Basic, empty username + PAT as password (`:{PAT}` base64).
- **Reads via the helper script** (`node <CONFIG.helper_script> <id|url>`) —
  read-only, allowlisted, prompt-free. Raw endpoint:
  ```
  GET {tracker_base_url}/_apis/wit/workitems/{ID}?$expand=all&api-version={api_version}
  ```
- Title = `System.Title`; steps = `Microsoft.VSTS.TCM.Steps` (XML — parse action
  + expected result); type = `System.WorkItemType` (must be `Test Case`).
- Failed tests for a build: Test Results REST API by `buildId`.
- **Update title (Step 11):** PATCH with JSON Patch; needs Work Items Write.
  ```
  PATCH {tracker_base_url}/_apis/wit/workitems/{ID}?api-version={api_version}
  Content-Type: application/json-patch+json
  [ { "op": "add", "path": "/fields/System.Title", "value": "{new_title}" } ]
  ```
  Read current title first; only if type is `Test Case` and title doesn't already
  end with `[Automated]`, set `{new_title}` = `"{current_title} [Automated]"`.

### jira  (stub — fill in when first needed)

- Auth: Basic `email:API_TOKEN` (token from `CONFIG.tracker_pat_env`).
- `GET {tracker_base_url}/rest/api/3/issue/{ID}` (or Xray/Zephyr for steps).
- Map: summary→title, description→description, steps→from the add-on.

### testrail  (stub — fill in when first needed)

- Auth: Basic `email:API_KEY`.
- `GET {tracker_base_url}/index.php?/api/v2/get_case/{ID}`.
- Map: title→title, custom steps field→steps + expected results.

---

## SETTINGS-DRIVEN DIAGNOSIS  (don't fail on a missing feature — check the setting first)

Many EP features are gated by **system settings** on the PrimeroEdge web admin
(`https://qa.primeroedge.co/System/ManageSettings.aspx`, after ticking **Show
Internal Settings**). A lot of "element not found" failures are NOT app/test bugs
— the feature is simply **toggled off** on the web.

**Rule — when a test can't find an expected control/screen, before failing it:**
1. Map the missing feature to its setting code using the catalog
   **`settings-dump.json`** (full list of every ManageSettings entry: code, type,
   current value, options — regenerate any time with the dump approach below).
2. Check that setting's live status on ManageSettings (Show Internal Settings on).
3. If it's off and the feature needs it on, **toggle it on and Save**, then
   **re-run** the test. Use the existing helper:
   `setSettings(webPage, { CODE: 'Yes' })` in `utils/primeroedge-settings.ts`
   (it returns the previous values and saves once). **ALWAYS verify it actually
   persisted** by re-reading the value after saving — see the caveat below.
4. **Only if it STILL fails** after the setting is correctly on → flag it as a
   real bug / needs-investigation and tell the user. Never just fail because a
   control is missing without first checking the setting.

> **CAVEAT — `setSettings` is NOT fully reliable for radio settings.** ManageSettings
> is a **Telerik RadGrid**; touching a Yes/No radio fires an AutoPostBack that
> re-renders the row, and a programmatic click can be wiped by that re-render (the
> "Settings saved successfully" banner can even appear while the value reverts).
> Its Save-button locator also uses `hasText`, which misses `input[type=submit]`
> (the label is in the `value` attr — `getByRole('button',{name:/Save Settings/i})`
> is the fix). **So: after any programmatic toggle, RE-READ the setting; if it
> didn't persist, ask the user to flip it manually on the web** (manual toggle →
> Save → "saved successfully" is reliable). Don't assume a "saved" message means it
> stuck. (TODO: make `setSettings` postback-aware + fix the Save locator.)

**Known feature → setting mappings:**
- **Payments / Add Funds funding screen** (Cash/Check tabs, PIN+LOOKUP segments)
  → **`SCHPREPAY`** = "State Specific (WV) - Accept Payments at Sites" must be
  **Yes**. Required by `payments` and `t-115635`. NOTE: `system_settings` toggles
  `SCHPREPAY` and can leave it `No` if its restore is interrupted (e.g. VPN/web
  drop) — re-enable it before running the funding tests.
- Accept Credit Cards → `CREDCADPAY`; Display Check Button on POS → `POSCHKBUT`;
  Hide balance → `HIDEBAL`; Hide eligibility → `HIDELGBLTY`.

**Regenerate the catalog** (writes `settings-dump.json`): log into the web with
`loginToPrimeroEdgeQa`, go to ManageSettings, tick Show Internal Settings, scroll
to render all lazy rows, then read every `tr` (code `<td>` + radio/select/text
control) and dump code/kind/value/options to JSON. (A throwaway spec under
`tests/` can do this — keep it out of regular suite runs, or delete it after.)

---

## CONVENTIONS

- Follow the repo's existing patterns (Step 0) over any assumption here.
- Prefer complete, copy-pasteable files over partial diffs.
- Never commit secrets; read from `.env`. Never accept secrets in chat.
- Keep locator stores clean: persist only genuinely reusable selectors.
- Reads are prompt-free (helper/allowlist); writes (PATCH, push) stay reviewed.
- **Always bound clicks/waits with an explicit timeout.** `playwright.config.ts`
  sets no `actionTimeout` (Playwright default = 0 = wait forever), so a `.click()`
  on a control covered by a stray overlay (Meal Type picker, `user_ppup` popover,
  "Checking Sessions…" modal, etc.) hangs until the test's multi-minute hard
  timeout instead of failing fast. Pass `{ timeout: ... }` to `.click()` on the
  serving/POS screens, and dismiss known overlays first
  (`ensureMealTypeSelected` / `dismissOpenPopovers` in `utils/serving.ts`).
  (Optional global fix: set `use.actionTimeout` in the config.)

### Clean up after every fix session (ALWAYS, as the final step)

When a `regression` / `fixtests` / test-fix session is **done**, leave the working
tree containing **only the meaningful changes** — the actual test/helper fixes.
Remove the run clutter generated along the way:
- **Delete** transient run artifacts: `playwright-*.log` run logs, any throwaway
  diagnostic specs created during triage (e.g. temp `tests/zz-*.spec.ts`),
  scratch screenshots/traces left outside the gitignored `test-results/`.
- **NEVER delete**: the real test/code fixes, `CLAUDE.md` / any `.md` / rules,
  `settings-dump.json` (the settings catalog), config files
  (`.gitignore`, `.claude/settings.local.json`), and the user's pre-existing
  changes (don't revert changes you didn't make this session).
- Run `git status` at the end and confirm the diff is just the fixes + docs.
  If unsure whether a change is "yours/necessary", leave it and ask — don't
  revert the user's work.

---

## NOTES / TODO

- [ ] First run in a new repo: `read claude` to onboard (creates helper +
      settings, collects CONFIG).
- [ ] RingCentral webhook follow-up after `fixtests` resolves all failures.
