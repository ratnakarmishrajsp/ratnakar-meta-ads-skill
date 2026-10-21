// Job 2: daily ads report. Spend, purchases, ROAS, CPA per campaign / ad set / ad, marked WORKING or BURNING CASH.
// Read-only. Usage: node scripts/report_daily.mjs [--date today|yesterday|YYYY-MM-DD | --days 3 | --since .. --until ..] [--all] [--json]
import { parseArgs, run, resolveWindow, money, ratio, pct, cut, table, printSources, printWarnings, num } from './lib/cli.mjs';
import { loadEnv, readCreds } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { metaClient, AD_FIELDS, rollup, derive, fromMinor } from './lib/meta.mjs';
import { typicalBreakEven } from './lib/economics.mjs';

const ACTIVE = ['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES'];

run(async () => {
  const args = parseArgs();
  loadEnv(args.env);
  const creds = readCreds();
  const cfg = loadConfig(args);
  const win = resolveWindow(args, cfg.timezone, 1);
  const sources = [], warnings = [];
  const meta = metaClient(creds);
  const cur = cfg.currency;

  const acc = await meta.get(meta.account, { fields: 'name,currency,timezone_name,account_status,disable_reason,spend_cap,amount_spent' });
  const rows = await meta.insights('ad', win.since, win.until, AD_FIELDS);
  sources.push(`Meta Marketing API ${meta.version} — ad-level insights ${win.label}, account timezone ${acc.timezone_name}, Meta's default attribution setting`);
  const ro = rollup(rows);

  const filtering = [{ field: 'effective_status', operator: 'IN', value: ACTIVE }];
  const [camps, adsets, ads] = await Promise.all([
    meta.getAll(`${meta.account}/campaigns`, { fields: 'id,name,effective_status,daily_budget,lifetime_budget,created_time', filtering }),
    meta.getAll(`${meta.account}/adsets`, { fields: 'id,name,campaign_id,effective_status,daily_budget,lifetime_budget,created_time,learning_stage_info', filtering }),
    meta.getAll(`${meta.account}/ads`, { fields: 'id,name,adset_id,campaign_id,effective_status,created_time', filtering: [{ field: 'effective_status', operator: 'IN', value: [...ACTIVE, 'DISAPPROVED', 'PENDING_REVIEW'] }] }),
  ]);
  const info = new Map([...camps, ...adsets, ...ads].map((o) => [o.id, o]));
  for (const [edge, list] of [['campaigns', ro.campaign], ['adsets', ro.adset], ['ads', ro.ad]]) {
    const unknown = list.map((b) => b.id).filter((id) => !info.has(id));
    if (!unknown.length) continue;
    const f = edge === 'ads' ? 'id,name,effective_status,created_time' : 'id,name,effective_status,daily_budget,lifetime_budget,created_time';
    for (const o of await meta.byIds(edge, unknown, f)) info.set(o.id, o);
  }
  // Active things with zero spend in the window still belong in the report.
  const addZero = (list, objs, extra) => { for (const o of objs) if (!list.some((b) => b.id === o.id)) list.push({ id: o.id, name: o.name, spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0, atc: 0, ic: 0, ...extra(o) }); };
  addZero(ro.campaign, camps, () => ({}));
  addZero(ro.adset, adsets, (o) => ({ campaign_id: o.campaign_id }));
  addZero(ro.ad, ads.filter((a) => ['ACTIVE', 'IN_PROCESS'].includes(a.effective_status)), (o) => ({ campaign_id: o.campaign_id, adset_id: o.adset_id }));

  const total = derive(ro.total);
  const aov = total.purchases ? total.revenue / total.purchases : cfg.assumptions.aov;
  const be = cfg._missing || cfg._isExample ? { roas: null, why: cfg._missing ? 'no config.json' : 'config still has example numbers' } : typicalBreakEven(cfg, aov);
  const burn = cfg.report.burning_cash_spend ?? (be.cpa ? 2 * be.cpa : null);
  const judge = cfg.report.min_spend_to_judge ?? (be.cpa ?? null);
  if (be.roas) sources.push(`Break-even ROAS ${ratio(be.roas)} / CPA ${money(be.cpa, cur)} (ex-GST) from ${be.why}`);
  else warnings.push(`Break-even ROAS unknown (${be.why}); WORKING means "has sales", not "is profitable".`);
  if (burn == null) warnings.push('No BURNING CASH threshold (set report.burning_cash_spend in config); zero-sale spend is listed but not labelled.');
  else sources.push(`BURNING CASH = spend ≥ ${money(burn, cur)} with 0 purchases (${cfg.report.burning_cash_spend != null ? 'config report.burning_cash_spend' : '2 × break-even CPA'})`);

  const label = (b) => {
    if (!b.spend) return '⚪ NO SPEND';
    if (!b.purchases) {
      if (burn != null && b.spend >= burn) return '🔴 BURNING CASH';
      if (judge != null && b.spend < judge) return '⚪ TOO EARLY';
      return '🟠 NO SALE YET';
    }
    if (be.roas == null) return '🟢 WORKING (sales)';
    return b.roas >= be.roas ? '🟢 WORKING' : '🟠 SALES BELOW BREAK-EVEN';
  };
  const status = (id) => info.get(id)?.effective_status || '?';
  const budget = (id) => { const o = info.get(id); const d = fromMinor(o?.daily_budget); return d ? `${money(d, cur)}/day` : fromMinor(o?.lifetime_budget) ? 'lifetime' : '—'; };
  const ageH = (id) => { const c = info.get(id)?.created_time; return c ? Math.round((Date.now() - Date.parse(c)) / 3600e3) : null; };
  const rowOf = (b, extra = []) => { const d = derive(b); return [cut(d.name, 48), ...extra, money(d.spend, cur), d.purchases, money(d.revenue, cur), ratio(d.roas), money(d.cpa, cur), pct(d.ctr, 2), money(d.cpc, cur), label(d)]; };
  const H = ['Spend', 'Purch.', 'Revenue', 'ROAS', 'CPA', 'CTR', 'CPC', 'Verdict'];
  const bySpend = (a, b) => b.spend - a.spend;

  if (args.json) {
    console.log(JSON.stringify({ window: win, account: { name: acc.name, currency: acc.currency, timezone: acc.timezone_name }, total, breakEven: be, burn,
      campaigns: ro.campaign.map((b) => ({ ...derive(b), status: status(b.id), verdict: label(derive(b)) })),
      adsets: ro.adset.map((b) => ({ ...derive(b), status: status(b.id), learning: info.get(b.id)?.learning_stage_info?.status, verdict: label(derive(b)) })),
      ads: ro.ad.map((b) => ({ ...derive(b), status: status(b.id), verdict: label(derive(b)) })), sources, warnings }, null, 2));
    return;
  }

  const gst = cfg.gst.meta_gst_pct || 0;
  console.log(`# Ads report: ${win.label}${win.isToday ? ' (today so far)' : ''}`);
  console.log(`Account "${acc.name}" | ${new Date().toLocaleString('en-IN', { timeZone: cfg.timezone })} (${cfg.timezone})\n`);
  console.log(table(['Metric', 'Value'], [
    ['Spend (ex-GST, as Meta shows)', money(total.spend, cur)],
    [`Spend incl. ${gst}% GST (what the bank pays)`, money(total.spend * (1 + gst / 100), cur)],
    ['Purchases (Meta-reported)', total.purchases],
    ['Revenue (Meta-reported)', money(total.revenue, cur)],
    ['ROAS (Meta)', ratio(total.roas)],
    ['CPA (Meta)', money(total.cpa, cur)],
    ['CTR / CPC (link)', `${pct(total.ctr, 2)} / ${money(total.cpc, cur)}`],
    ['Break-even ROAS', be.roas ? ratio(be.roas) : 'unknown'],
  ]));
  console.log('\n> Meta-reported purchases are not yet checked against real Shopify orders. For that run profit_real.mjs.');

  console.log('\n## Campaigns');
  console.log(table(['Campaign', 'Status', 'Budget', ...H], ro.campaign.sort(bySpend).map((b) => rowOf(b, [status(b.id), budget(b.id)]))));
  console.log('\n## Ad sets');
  console.log(table(['Ad set', 'Status', 'Budget', 'Learning', 'Age h', ...H], ro.adset.sort(bySpend).map((b) => rowOf(b, [status(b.id), budget(b.id), info.get(b.id)?.learning_stage_info?.status || '—', ageH(b.id) ?? '—']))));
  const adRows = ro.ad.sort(bySpend);
  const shown = args.all ? adRows : adRows.filter((b, i) => i < 25 || label(derive(b)).includes('BURNING'));
  console.log(`\n## Ads${shown.length < adRows.length ? ` (top ${shown.length} of ${adRows.length}; --all for every ad)` : ''}`);
  console.log(table(['Ad', 'Status', 'Age h', ...H], shown.map((b) => rowOf(b, [status(b.id), ageH(b.id) ?? '—']))));

  const burning = [...ro.adset, ...ro.ad].map(derive).filter((b) => label(b).includes('BURNING'));
  console.log('\n## 🔴 Burning cash (spend with zero purchases)');
  console.log(burning.length ? burning.map((b) => `- ${b.name} (${b.id}): ${money(b.spend, cur)} spent, 0 purchases, CTR ${pct(b.ctr, 2)}, CPC ${money(b.cpc, cur)}`).join('\n') : 'None.');

  const alerts = [];
  if (acc.account_status !== 1) alerts.push(`Ad account status is ${acc.account_status} (not ACTIVE)${acc.disable_reason ? `, disable reason ${acc.disable_reason}` : ''}`);
  const dailyBudgets = [...camps, ...adsets].reduce((s, o) => s + (fromMinor(o.daily_budget) || 0), 0);
  if (num(acc.spend_cap) > 0) {
    const head = (num(acc.spend_cap) - num(acc.amount_spent)) / 100;
    if (head < dailyBudgets * 2) alerts.push(`Spend-cap headroom only ${money(head, cur)} (< 2 days of active budgets ${money(dailyBudgets, cur)}/day); delivery stops when it runs out`);
  }
  for (const a of ads) if (['DISAPPROVED', 'WITH_ISSUES'].includes(a.effective_status)) alerts.push(`Ad "${a.name}" (${a.id}) is ${a.effective_status}`);
  if (win.isToday) for (const c of camps) if (!ro.campaign.find((b) => b.id === c.id)?.spend) alerts.push(`Campaign "${c.name}" is ACTIVE but has spent nothing today`);
  console.log('\n## ⚠️ Alerts');
  console.log(alerts.length ? alerts.map((a) => `- ${a}`).join('\n') : 'None.');
  if (win.isToday) warnings.push('Today is not over; purchases often arrive with a delay of hours (attribution lag). Judge on 3+ days.');
  printWarnings(warnings);
  printSources(sources);
});
