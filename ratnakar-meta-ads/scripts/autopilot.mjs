// Job 5: "Fix my ads". Rule-based: stop-loss for zero-sale ads, pause clear losers, scale winners by at most
// +20% per step, inside a daily budget cap. Default = DRY RUN that writes a numbered plan. Nothing changes until
// the user approves specific numbers. This script never runs by itself; do not schedule it unless the user asks.
//
// Dry run:  node scripts/autopilot.mjs [--since YYYY-MM-DD (count "lifetime" from a relaunch date)]
// Execute:  node scripts/autopilot.mjs --execute --plan <plan file> --approve 1,3 --note "user: haan 1 aur 3 karo"
import { parseArgs, run, todayIn, addDays, money, ratio, pct, cut, table, printSources, printWarnings, hoursSince, fail } from './lib/cli.mjs';
import { loadEnv, readCreds } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { metaClient, rollup, rowToBucket, derive, fromMinor, toMinor, AD_FIELDS } from './lib/meta.mjs';
import { typicalBreakEven } from './lib/economics.mjs';
import { savePlan, loadPlan, approvedActions, logChange, readChanges } from './lib/log.mjs';

const ACTIVE = [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }];

run(async () => {
  const args = parseArgs();
  loadEnv(args.env);
  const creds = readCreds();
  const cfg = loadConfig(args, { required: true });
  const meta = metaClient(creds);
  if (args.execute) return execute(meta, cfg, args);

  const ap = cfg.autopilot, cur = cfg.currency, tz = cfg.timezone;
  const sources = [`Rules and thresholds: ${cfg._file} (autopilot section)`], warnings = [];
  const today = todayIn(tz), d3since = addDays(today, -2);

  const [camps, adsets, ads] = await Promise.all([
    meta.getAll(`${meta.account}/campaigns`, { fields: 'id,name,daily_budget,lifetime_budget,created_time', filtering: ACTIVE }),
    meta.getAll(`${meta.account}/adsets`, { fields: 'id,name,campaign_id,daily_budget,lifetime_budget,created_time,learning_stage_info', filtering: ACTIVE }),
    meta.getAll(`${meta.account}/ads`, { fields: 'id,name,adset_id,campaign_id,created_time', filtering: ACTIVE }),
  ]);
  const life = args.since ? { time_range: { since: args.since, until: today } } : { date_preset: 'maximum' };
  const ins = (level, fields, extra) => meta.getAll(`${meta.account}/insights`, { level, fields, limit: 500, ...extra });
  const only = (lvl) => ({ filtering: [{ field: `${lvl}.effective_status`, operator: 'IN', value: ['ACTIVE'] }] });
  const SET_FIELDS = 'adset_id,adset_name,campaign_id,spend,impressions,inline_link_clicks,actions,action_values';
  const [lifeAdRows, lifeSetRows, d3Rows] = await Promise.all([
    ins('ad', AD_FIELDS, { ...life, ...only('ad') }),
    ins('adset', SET_FIELDS, { ...life, ...only('adset') }),
    ins('ad', AD_FIELDS, { time_range: { since: d3since, until: today } }),
  ]);
  sources.push(`Meta Marketing API ${meta.version}: active campaigns/ad sets/ads, insights ${args.since ? 'since ' + args.since : 'lifetime'} and last 3 days (${d3since} → ${today})`);
  const L = { ad: rollup(lifeAdRows).ad, adset: lifeSetRows.map((r) => rowToBucket(r, r.adset_id, r.adset_name)) };
  L.total = lifeSetRows.reduce((t, r) => { const b = rowToBucket(r); t.purchases += b.purchases; t.revenue += b.revenue; return t; }, { purchases: 0, revenue: 0 });
  const D = rollup(d3Rows);
  const pick = (r, lvl, id) => derive(r[lvl].find((b) => b.id === id) || { id, spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 });

  // Break-even from config costs + Meta's own AOV (last 3 days, else lifetime, else assumptions.aov).
  const aovOf = (t) => (t.purchases ? t.revenue / t.purchases : null);
  const be = typicalBreakEven(cfg, aovOf(D.total) || aovOf(L.total) || cfg.assumptions.aov);
  if (be.roas) sources.push(`Break-even ROAS ${ratio(be.roas)} / CPA ${money(be.cpa, cur)} from ${be.why}`);
  else warnings.push(`Break-even unknown (${be.why}); rules that need it are OFF unless the thresholds are set as numbers in config.autopilot.`);
  const T = {
    stopLoss: ap.stop_loss_spend ?? (be.cpa ? 2 * be.cpa : null),
    pauseMin: ap.pause_min_spend ?? (be.cpa ? 3 * be.cpa : null),
    pauseRoas: ap.pause_roas_below ?? be.roas,
    scaleRoas: ap.scale_roas_at_least ?? (be.roas ? be.roas * (ap.scale_margin_over_break_even || 1.3) : null),
  };
  sources.push(`Thresholds: stop-loss ${money(T.stopLoss, cur)} with 0 purchases | pause ad set if spend ≥ ${money(T.pauseMin, cur)} and ROAS < ${ratio(T.pauseRoas)} (lifetime AND 3-day) | scale if 3-day ROAS ≥ ${ratio(T.scaleRoas)} with ≥ ${ap.scale_min_purchases} purchases | +${ap.max_budget_increase_pct}% max per step, ${ap.min_hours_between_budget_changes} h apart`);

  // Last budget change per object: Meta activity log (72h+) plus our own change log.
  const lastChange = new Map();
  try {
    const since = Math.floor((Date.now() - (ap.min_hours_between_budget_changes + 24) * 3600e3) / 1000);
    const acts = await meta.getAll(`${meta.account}/activities`, { fields: 'event_type,event_time,object_id', since, limit: 500 }, { maxPages: 5 });
    for (const a of acts) if (/budget/i.test(a.event_type || '')) { const t = Date.parse(a.event_time); if (!(lastChange.get(a.object_id) > t)) lastChange.set(a.object_id, t); }
    sources.push(`Meta activity log (budget changes in the last ${ap.min_hours_between_budget_changes + 24} h)`);
  } catch (e) { warnings.push(`Meta activity log not readable (${e.message}); only this skill's own change log is used to space budget changes.`); }
  for (const e of readChanges(24 * 30)) if (e.action === 'budget') { const t = Date.parse(e.at); if (!(lastChange.get(e.id) > t)) lastChange.set(e.id, t); }

  const actions = [], holds = [];
  const age = (o) => hoursSince(o.created_time);
  const learning = (s) => s.learning_stage_info?.status === 'LEARNING';

  // A. Ad-level stop-loss
  for (const a of ads) {
    const l = pick(L, 'ad', a.id);
    if (age(a) < ap.min_age_hours_ad) { holds.push(['ad', a.name, `only ${Math.round(age(a))} h old (min ${ap.min_age_hours_ad} h)`]); continue; }
    if (T.stopLoss != null && l.spend >= T.stopLoss && l.purchases === 0) {
      const siblings = ads.filter((x) => x.adset_id === a.adset_id);
      actions.push({ type: 'pause', level: 'ad', id: a.id, name: a.name, before: 'ACTIVE', after: 'PAUSED',
        reason: `${money(l.spend, cur)} spent${args.since ? ' since ' + args.since : ''}, 0 purchases (stop-loss ${money(T.stopLoss, cur)}); CTR ${pct(l.ctr, 2)}, CPC ${money(l.cpc, cur)}`,
        caution: siblings.length === 1 ? 'Last active ad in its ad set: pausing it stops that ad set.' : null });
    }
  }
  // B. Ad set pause: clear losers only, never in learning (if configured), never a 3-day winner
  for (const s of adsets) {
    const l = pick(L, 'adset', s.id), d = pick(D, 'adset', s.id);
    if (age(s) < ap.min_age_hours_adset) { holds.push(['ad set', s.name, `only ${Math.round(age(s))} h old (min ${ap.min_age_hours_adset} h)`]); continue; }
    if (T.scaleRoas != null && d.roas != null && d.roas >= T.scaleRoas) { holds.push(['ad set', s.name, `protected: 3-day ROAS ${ratio(d.roas)}`]); continue; }
    if (learning(s) && ap.skip_if_learning) { holds.push(['ad set', s.name, 'in learning phase: no ad-set decisions yet']); continue; }
    if (T.pauseMin != null && T.pauseRoas != null && l.spend >= T.pauseMin && (l.roas ?? 0) < T.pauseRoas && (d.roas ?? 0) < T.pauseRoas) {
      actions.push({ type: 'pause', level: 'adset', id: s.id, name: s.name, before: 'ACTIVE', after: 'PAUSED',
        reason: `${money(l.spend, cur)} spent, ${l.purchases} purchases, ROAS ${ratio(l.roas)} (3-day ${ratio(d.roas)}) below ${ratio(T.pauseRoas)} after ${Math.round(age(s))} h` });
    }
  }
  // C. Scale winners (budget lives on the campaign for CBO, on the ad set for ABO)
  const owners = [
    ...camps.filter((c) => fromMinor(c.daily_budget)).map((c) => ({ level: 'campaign', o: c, kids: adsets.filter((s) => s.campaign_id === c.id) })),
    ...adsets.filter((s) => fromMinor(s.daily_budget)).map((s) => ({ level: 'adset', o: s, kids: [s] })),
  ];
  let total = owners.reduce((sum, w) => sum + fromMinor(w.o.daily_budget), 0);
  const paused = new Set(actions.map((a) => a.id));
  for (const { level, o, kids } of owners) {
    const d = pick(D, level, o.id), old = fromMinor(o.daily_budget);
    const why = [];
    if (age(o) < ap.min_age_hours_adset) why.push(`only ${Math.round(age(o))} h old`);
    if (ap.skip_if_learning && kids.some(learning)) why.push('learning phase');
    if (kids.some((k) => paused.has(k.id)) || paused.has(o.id)) why.push('has a pause proposed');
    if (T.scaleRoas == null) why.push('no scale threshold');
    else if (d.purchases < ap.scale_min_purchases || (d.roas ?? 0) < T.scaleRoas) why.push(`3-day ${d.purchases} purchases @ ${ratio(d.roas)} (needs ≥ ${ap.scale_min_purchases} @ ${ratio(T.scaleRoas)})`);
    const lc = lastChange.get(o.id);
    if (lc && (Date.now() - lc) / 3600e3 < ap.min_hours_between_budget_changes) why.push(`budget changed ${Math.round((Date.now() - lc) / 3600e3)} h ago`);
    if (why.length) { holds.push([level === 'campaign' ? 'campaign' : 'ad set', o.name, `budget ${money(old, cur)}: ${why.join('; ')}`]); continue; }
    let next = Math.round(old * (1 + ap.max_budget_increase_pct / 100));
    if (ap.max_daily_budget_per_item != null) next = Math.min(next, ap.max_daily_budget_per_item);
    if (ap.max_total_daily_budget != null) next = Math.min(next, old + Math.max(0, ap.max_total_daily_budget - total));
    if (next <= old) { holds.push([level, o.name, `winner (${ratio(d.roas)}, ${d.purchases} purchases) but at the budget cap`]); continue; }
    total += next - old;
    actions.push({ type: 'budget', level, id: o.id, name: o.name, before: old, after: next,
      reason: `3-day ${d.purchases} purchases, ROAS ${ratio(d.roas)} ≥ ${ratio(T.scaleRoas)}, spend ${money(d.spend, cur)}; +${Math.round((next / old - 1) * 100)}% (cap +${ap.max_budget_increase_pct}%)` });
  }
  if (ap.max_total_daily_budget == null) warnings.push('autopilot.max_total_daily_budget is not set: there is no account-wide budget cap.');

  actions.forEach((a, i) => { a.n = i + 1; });
  const file = savePlan('autopilot', actions, { thresholds: T, breakEven: be, account: meta.account });
  console.log(`# Fix my ads: proposed changes (DRY RUN, nothing changed)\n`);
  console.log(actions.length ? table(['#', 'Change', 'Name', 'Before → After', 'Why'], actions.map((a) => [
    a.n, a.type === 'pause' ? `Pause ${a.level}` : `Budget ${a.level}`, cut(a.name, 40),
    a.type === 'pause' ? 'ACTIVE → PAUSED' : `${money(a.before, cur)} → ${money(a.after, cur)}/day`, a.reason + (a.caution ? ` ⚠️ ${a.caution}` : '')])) : 'No changes proposed. Nothing meets the pause or scale rules right now.');
  console.log('\n## Not touched (and why)');
  console.log(table(['Level', 'Name', 'Reason'], holds.map(([l, n, r]) => [l, cut(n, 45), r])));
  console.log(`\nPlan saved: ${file}`);
  if (actions.length) console.log('Ask the user about EACH numbered change. Then run:\nnode scripts/autopilot.mjs --execute --plan "<plan file>" --approve <numbers> --note "<user\'s exact words>"');
  printWarnings(warnings);
  printSources(sources);
});

async function execute(meta, cfg, args) {
  const plan = loadPlan(args.plan, 'autopilot', cfg.autopilot.plan_valid_hours);
  if (plan.account !== meta.account) fail('This plan was made for a different ad account.');
  const todo = approvedActions(plan, args.approve);
  const cur = cfg.currency;
  meta.unlockWrites();
  console.log(`# Executing ${todo.length} approved change(s)\n`);
  for (const a of todo) {
    const now = await meta.get(a.id, { fields: 'name,status,daily_budget' });
    if (now.name !== a.name) { console.log(`⏭️  #${a.n} skipped: name is now "${now.name}", plan said "${a.name}". Nothing changed.`); continue; }
    if (a.type === 'pause') {
      if (now.status !== 'ACTIVE') { console.log(`⏭️  #${a.n} skipped: ${a.name} is already ${now.status}.`); continue; }
      await meta.post(a.id, { status: 'PAUSED' });
    } else {
      if (fromMinor(now.daily_budget) !== a.before) { console.log(`⏭️  #${a.n} skipped: budget is now ${money(fromMinor(now.daily_budget), cur)}, plan expected ${money(a.before, cur)}.`); continue; }
      await meta.post(a.id, { daily_budget: toMinor(a.after) });
    }
    const back = await meta.get(a.id, { fields: 'status,daily_budget' });
    const after = a.type === 'pause' ? back.status : money(fromMinor(back.daily_budget), cur);
    logChange({ job: 'autopilot', action: a.type, level: a.level, id: a.id, name: a.name, before: a.before, after: a.after, readBack: after, reason: a.reason, note: args.note || null, plan: args.plan });
    console.log(`✅ #${a.n} ${a.type === 'pause' ? 'Paused' : 'Budget set'}: ${a.name} → ${after}`);
  }
  console.log('\nEvery change is in the change log (META_ADS_DATA_DIR/changes.log.jsonl). To undo a pause, set the item ACTIVE again in Ads Manager.');
}
