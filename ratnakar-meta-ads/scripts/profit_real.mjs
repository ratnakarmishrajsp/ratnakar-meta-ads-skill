// Job 3: "Am I really in profit?" Meta revenue → minus product cost, shipping, COD, RTO, GST → net profit,
// then the same from real Shopify clean orders (cancelled, test and duplicate orders removed). Read-only.
// Usage: node scripts/profit_real.mjs [--date today|yesterday|YYYY-MM-DD | --days 7 | --since .. --until ..] [--json]
import { parseArgs, run, resolveWindow, money, ratio, pct, table, printSources, printWarnings, safeDiv } from './lib/cli.mjs';
import { loadEnv, readCreds } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { loadMeta, loadOrders } from './lib/data.mjs';
import { orderEconomics, sumEconomics, breakEven, metaGstFactor } from './lib/economics.mjs';
import { orderNumberKey } from './lib/shiprocket.mjs';
import { isFromMeta } from './lib/shopify.mjs';

run(async () => {
  const args = parseArgs();
  loadEnv(args.env);
  const creds = readCreds();
  const cfg = loadConfig(args, { required: true });
  const win = resolveWindow(args, cfg.timezone, 1);
  const cur = cfg.currency;
  const sources = [`Costs and fees: ${cfg._file}`], warnings = [];

  const { totals: m } = await loadMeta(creds, cfg, win, sources, warnings);
  const d = await loadOrders(creds, cfg, win, sources, warnings);
  const c = d.clean;
  const gf = metaGstFactor(cfg);
  const adCost = m.spend * gf;

  // ---- Shopify reality: every clean order, outcome-aware when Shiprocket knows it ----
  const econ = c.clean.map((o) => orderEconomics(o, cfg, d.rates, d.shipIndex.get(orderNumberKey(o.name))));
  const s = sumEconomics(econ);
  const be = breakEven(s, cfg);
  const net = s.missing.length ? null : s.contribution - adCost;
  const matched = c.clean.filter((o) => d.shipIndex.has(orderNumberKey(o.name))).length;
  if (d.shipments.length) sources.push(`Shiprocket matched ${matched} of ${c.clean.length} clean orders (actual charges used where Shiprocket has them)`);

  // ---- Meta's claim, costed the same way (average clean order costs applied to Meta's purchases) ----
  let metaView = null;
  if (m.purchases && s.orders) {
    const perOrderCost = (s.revenue - s.contribution) / s.orders; // all costs per order (incl. expected RTO loss) from the real mix
    const costShare = (s.revenue - s.contribution) / s.revenue;
    metaView = { revenue: m.revenue, costs: m.revenue * costShare, perOrderCost };
    metaView.net = m.revenue - metaView.costs - adCost;
  }

  const metaShopifyOrders = c.clean.filter(isFromMeta).length;
  const hasJourney = c.clean.some((o) => o.utmSource);
  const verdict = net == null ? '❓ Cannot compute net profit (missing inputs below)'
    : net > 0 ? `🟢 PROFIT ${money(net, cur)}` : `🔴 LOSS ${money(-net, cur)}`;

  if (args.json) {
    console.log(JSON.stringify({ window: win, meta: m, adCost, shopify: { gross: c.gross, cancelled: c.cancelled.length, test: c.test.length, duplicates: c.duplicates.length, excluded: c.excluded.length, clean: c.clean.length, cleanRevenue: c.cleanRevenue, cod: c.cod.length, codRevenue: c.codRevenue, prepaid: c.prepaid.length, prepaidRevenue: c.prepaidRevenue }, economics: s, breakEven: be, net, metaView, rates: d.rates, sources, warnings }, null, 2));
    return;
  }

  console.log(`# Real profit: ${win.label}${win.isToday ? ' (today so far)' : ''}\n`);
  console.log(`**Verdict: ${verdict}**${net != null ? ` (clean ROAS ${ratio(safeDiv(c.cleanRevenue, m.spend))} vs break-even ${ratio(be.roas)})` : ''}\n`);

  console.log('## 1. What Meta says');
  console.log(table(['Metric', 'Value'], [
    ['Ad spend (ex-GST)', money(m.spend, cur)],
    [`Ad cost you pay${cfg.gst.claim_meta_gst_credit ? ' (GST credit claimed)' : ` (incl. ${cfg.gst.meta_gst_pct}% GST)`}`, money(adCost, cur)],
    ['Purchases (Meta)', m.purchases],
    ['Revenue (Meta)', money(m.revenue, cur)],
    ['ROAS (Meta)', ratio(safeDiv(m.revenue, m.spend))],
    ...(metaView ? [
      ['− product, shipping, COD, gateway, RTO, GST (same % as your real orders)', money(metaView.costs, cur)],
      ['= Net profit IF Meta\'s purchases were all real', money(metaView.net, cur)],
    ] : [['Net profit on Meta numbers', m.purchases ? 'n/a (no clean Shopify orders to take the cost mix from)' : 'n/a (no Meta purchases)']]),
  ]));

  console.log('\n## 2. What really happened (Shopify clean orders)');
  console.log(table(['Orders', 'Count', 'Value'], [
    ['Gross orders', c.gross, money(d.orders.reduce((a, o) => a + o.value, 0), cur)],
    ['− cancelled', c.cancelled.length, money(c.cancelled.reduce((a, o) => a + o.value, 0), cur)],
    ['− duplicate submissions', c.duplicates.length, money(c.duplicates.reduce((a, o) => a + o.value, 0), cur)],
    ['− test / excluded tags', c.test.length + c.excluded.length, money([...c.test, ...c.excluded].reduce((a, o) => a + o.value, 0), cur)],
    ['= Clean orders', c.clean.length, money(c.cleanRevenue, cur)],
    ['  COD', c.cod.length, money(c.codRevenue, cur)],
    ['  Prepaid (paid online at checkout)', c.prepaid.length, money(c.prepaidRevenue, cur)],
  ]));

  console.log('\n## 3. Profit and loss (Shopify clean orders)');
  const L = (k, label, sign = '−') => [`${sign} ${label}`, money(s[k], cur)];
  console.log(table(['Line', 'Amount'], [
    ['Clean revenue', money(s.revenue, cur)],
    L('salesGst', 'GST on sales'),
    L('rtoLostSales', 'Sales lost to RTO (expected + actual)'),
    L('productCost', 'Product cost (delivered orders) + RTO packaging loss'),
    L('forwardShipping', 'Forward shipping'),
    L('rtoShipping', 'RTO return shipping'),
    L('codFees', 'COD fees'),
    L('gatewayFees', 'Payment gateway fees'),
    ['= Contribution before ads', money(s.contribution, cur)],
    ['− Ad cost', money(adCost, cur)],
    ['= **NET PROFIT**', net == null ? 'n/a' : `**${money(net, cur)}**`],
  ]));
  if (s.missing.length) console.log(`\n❗ ${econ.length - s.orders} orders could not be costed. Missing: ${s.missing.join('; ')}. Fix config.json; nothing was guessed.`);
  console.log(`\nOutcomes: ${s.outcomes.delivered} delivered and ${s.outcomes.rto} RTO (actual, from Shiprocket), ${s.outcomes.expected} not closed yet (RTO applied as expected rate).`);

  console.log('\n## 4. Key ratios');
  console.log(table(['Ratio', 'Value', 'Meaning'], [
    ['Actual clean ROAS', ratio(safeDiv(c.cleanRevenue, m.spend)), 'clean Shopify revenue ÷ Meta spend (ex-GST); includes non-Meta orders'],
    ['Clean ROAS after RTO', ratio(safeDiv(s.revenue - s.rtoLostSales, m.spend)), 'revenue you expect to actually collect ÷ spend'],
    ['Break-even ROAS', ratio(be.roas), 'clean ROAS needed for zero profit with this order mix'],
    ['Clean CPA (ex-GST)', money(safeDiv(m.spend, c.clean.length), cur), `break-even CPA ${money(be.cpa, cur)}`],
    ['Contribution per order', money(be.perOrder, cur), 'what one clean order leaves before ads'],
    ['Prepaid Day-0 recovery', pct(safeDiv(c.prepaidRevenue * 100, m.spend), 0), 'prepaid revenue already in the bank ÷ ad spend'],
  ]));

  console.log('\n## 5. Cross-check: Meta vs Shopify');
  const gap = m.purchases - c.clean.length;
  console.log(`- Meta purchases ${m.purchases} vs Shopify clean orders ${c.clean.length} (${gap > 0 ? `Meta claims ${gap} more` : gap < 0 ? `Shopify has ${-gap} more (organic, other channels or Meta under-tracking)` : 'equal'}).`);
  console.log(hasJourney ? `- Shopify credits ${metaShopifyOrders} clean orders to Facebook/Instagram by UTM / referrer (last visit).` : '- Shopify did not return visit/UTM data, so per-order Meta attribution is not available.');
  console.log('- Meta counts purchases by its attribution window (click + view), including cancelled and duplicate checkouts; Shopify counts every order from every channel. Use the clean numbers for money decisions.');
  if (win.isToday) warnings.push('Today is not over; Meta purchases can still arrive (attribution lag) and RTO for today\'s orders is only an expectation.');
  printWarnings(warnings);
  printSources(sources);
});
