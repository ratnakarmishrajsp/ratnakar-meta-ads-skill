// Plans (what a write job WOULD do) and the change log (what it DID). Stored locally in META_ADS_DATA_DIR
// (default ~/.ratnakar-meta-ads). Nothing here is ever sent anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.mjs';
import { fail } from './cli.mjs';

export function savePlan(job, actions, meta = {}) {
  const dir = path.join(dataDir(), 'plans');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${job}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ job, created: new Date().toISOString(), ...meta, actions }, null, 2));
  return file;
}

export function loadPlan(file, job, validHours) {
  if (!file || file === true) fail('--execute needs --plan <file> (from a dry run) and --approve <numbers>.');
  if (!fs.existsSync(file)) fail(`Plan file not found: ${file}`);
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (plan.job !== job) fail(`That plan is for "${plan.job}", not "${job}".`);
  const ageH = (Date.now() - Date.parse(plan.created)) / 3600e3;
  if (validHours && ageH > validHours) fail(`Plan is ${ageH.toFixed(1)} h old (limit ${validHours} h). Run the dry run again so decisions use fresh data.`);
  return plan;
}

// "--approve 1,3,4" or "--approve all". The user's own words go in --note and into the log.
export function approvedActions(plan, approve) {
  if (!approve || approve === true) fail('Say which actions the user approved: --approve 1,3 (or --approve all).');
  const all = plan.actions.filter((a) => a.n != null);
  if (String(approve).toLowerCase() === 'all') return all;
  const want = new Set(String(approve).split(',').map((s) => +s.trim()));
  const picked = all.filter((a) => want.has(a.n));
  const unknown = [...want].filter((n) => !all.some((a) => a.n === n));
  if (unknown.length) fail(`Plan has no action number(s) ${unknown.join(', ')}.`);
  return picked;
}

export function logChange(entry) {
  const file = path.join(dataDir(), 'changes.log.jsonl');
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  return file;
}

export function readChanges(sinceHours = 24 * 30) {
  const file = path.join(dataDir(), 'changes.log.jsonl');
  if (!fs.existsSync(file)) return [];
  const min = Date.now() - sinceHours * 3600e3;
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && Date.parse(e.at) >= min);
}
