#!/usr/bin/env node
/*
 * Read-only Azure DevOps helper for the `regression` / coverage checks.
 *
 *   node scripts/ado-workitem.js <workItemId | workItem URL | testPlan suite URL>
 *
 * - Reads AZURE_DEVOPS_PAT from .env (does NOT rely on shell env).
 * - GET only. Never writes / PATCHes anything.
 * - Test Case work item  -> prints TYPE / TITLE / STATE + parsed steps.
 * - Test Plan suite URL  -> lists the test cases in that suite (id + title).
 * - Non Test Case        -> prints "WRONG_LINK: <type>".
 *
 * Defaults (overridable via .env: ADO_ORG / ADO_PROJECT):
 *   org     = Cybersoft-Technologies-Inc
 *   project = PrimeroEdge Classic
 */

const fs = require('fs');
const path = require('path');

const API_VERSION = '7.0';
const DEFAULT_ORG = 'Cybersoft-Technologies-Inc';
const DEFAULT_PROJECT = 'PrimeroEdge Classic';

function readEnv() {
  const envPath = path.join(process.cwd(), '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = readEnv();
const PAT = env.AZURE_DEVOPS_PAT;
if (!PAT) {
  console.error('ERROR: AZURE_DEVOPS_PAT missing from .env');
  process.exit(1);
}
const ORG = env.ADO_ORG || DEFAULT_ORG;
const PROJECT = env.ADO_PROJECT || DEFAULT_PROJECT;
const AUTH = 'Basic ' + Buffer.from(':' + PAT).toString('base64');

function decodeSeg(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Figure out what the user gave us.
function parseInput(arg) {
  if (/^\d+$/.test(arg)) {
    return { kind: 'workitem', id: arg, org: ORG, project: PROJECT };
  }
  let u;
  try { u = new URL(arg); } catch {
    return { kind: 'unknown' };
  }
  const parts = u.pathname.split('/').filter(Boolean);
  const org = decodeSeg(parts[0] || ORG);
  const project = decodeSeg(parts[1] || PROJECT);

  const planId = u.searchParams.get('planId');
  const suiteId = u.searchParams.get('suiteId');
  if (planId && suiteId) {
    return { kind: 'suite', org, project, planId, suiteId };
  }
  // .../workitems/edit/12345  or  ?workitem=12345  or trailing numeric segment
  const wi = u.searchParams.get('workitem') || u.searchParams.get('id');
  if (wi && /^\d+$/.test(wi)) return { kind: 'workitem', id: wi, org, project };
  const lastNum = parts.reverse().find((p) => /^\d+$/.test(p));
  if (lastNum) return { kind: 'workitem', id: lastNum, org, project };
  return { kind: 'unknown' };
}

async function get(url) {
  const res = await fetch(url, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) {
    console.error(`ERROR: auth failed (HTTP ${res.status}). Check AZURE_DEVOPS_PAT scope/expiry.`);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`ERROR: HTTP ${res.status} for ${url}`);
    process.exit(3);
  }
  return res.json();
}

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>(?=)/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSteps(xml) {
  if (!xml) return [];
  const steps = [];
  const stepRe = /<step\b[^>]*>([\s\S]*?)<\/step>/gi;
  let m;
  while ((m = stepRe.exec(xml))) {
    const inner = m[1];
    const strRe = /<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/gi;
    const fields = [];
    let s;
    while ((s = strRe.exec(inner))) fields.push(stripHtml(s[1]));
    steps.push({ action: fields[0] || '', expected: fields[1] || '' });
  }
  return steps;
}

function baseOrgUrl(org) {
  return `https://dev.azure.com/${encodeURIComponent(org)}`;
}

async function showWorkItem(id, org, project) {
  const url = `${baseOrgUrl(org)}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?$expand=all&api-version=${API_VERSION}`;
  const wi = await get(url);
  const f = wi.fields || {};
  const type = f['System.WorkItemType'] || '(unknown)';
  const title = f['System.Title'] || '(no title)';
  const state = f['System.State'] || '(no state)';

  console.log(`ID: ${id}`);
  console.log(`TYPE: ${type}`);
  console.log(`TITLE: ${title}`);
  console.log(`STATE: ${state}`);

  if (type !== 'Test Case') {
    console.log(`WRONG_LINK: ${type}`);
    return;
  }
  const steps = parseSteps(f['Microsoft.VSTS.TCM.Steps']);
  console.log(`STEPS: ${steps.length}`);
  steps.forEach((st, i) => {
    console.log(`\n  Step ${i + 1}`);
    console.log(`    Action:   ${st.action || '(none)'}`);
    console.log(`    Expected: ${st.expected || '(none)'}`);
  });
}

async function showSuite(org, project, planId, suiteId) {
  const url = `${baseOrgUrl(org)}/${encodeURIComponent(project)}/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestCase?api-version=${API_VERSION}`;
  const data = await get(url);
  const list = data.value || [];
  console.log(`SUITE: plan ${planId} / suite ${suiteId}`);
  console.log(`TEST_CASES: ${list.length}`);
  for (const item of list) {
    const wi = item.workItem || {};
    const id = wi.id;
    const name = wi.name || '(no name)';
    console.log(`  - ${id}  ${name}`);
  }
  console.log(`\nTo see steps for one: node scripts/ado-workitem.js <id>`);
}

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/ado-workitem.js <workItemId | URL | suite URL>');
    process.exit(1);
  }
  const parsed = parseInput(arg);
  if (parsed.kind === 'workitem') {
    await showWorkItem(parsed.id, parsed.org, parsed.project);
  } else if (parsed.kind === 'suite') {
    await showSuite(parsed.org, parsed.project, parsed.planId, parsed.suiteId);
  } else {
    console.error('Could not parse a work item id or suite from that argument.');
    process.exit(1);
  }
})();
