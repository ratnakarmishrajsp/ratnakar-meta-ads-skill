// Job 7: "Orders + RTO today?" Shopify orders (clean, COD vs prepaid, fulfilment) and RTO
// from Shiprocket → Shopify tags → config, in that order. Read-only; no customer details are printed.
// Usage: node scripts/orders_rto.mjs [--date today (default) | yesterday | YYYY-MM-DD | --days 7] [--json]
import { parseArgs, run, resolveWindow, money, pct, table, printSources, printWarnings, safeDiv, hoursSince } from './lib/cli.mjs';
import { loadEnv, readCreds, has } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { loadMeta, loadOrders } from './lib/data.mjs';
import { orderNumberKey } from './lib/shiprocket.mjs';

run(async () => {
  const args = parseArgs();
  loadEnv(args.env);
  const creds = readCreds();
  const cfg = loadConfig(args);
  const win = resolveWindow(args, cfg.timezone, 1);
  const cur = cfg.currency;
  const sources = [], warnings = [];
  if (cfg._missing || cfg._isExample) warnings.push('No real config.json: prepaid/COD detection uses the default gateway lists and RTO falls back to Shiprocket / Shopify tags only.');

  const d = await loadOrders(creds, cfg, win, sources, warnings);
  const c = d.clean;
  let spend = null;
  if (has.meta(creds)) {
    try { spend = (await loadMeta(creds, cfg, win, sources, warnings)).totals.spend; }
    catch (e) { warnings.push(`Meta spend not fetched (${e.message}); prepaid recovery % not shown.`); }
  }

  const ful = {};
  for (const o of c.clean) ful[o.fulfillment] = (ful[o.fulfillment] || 0) + 1;
  const late = c.clean.filter((o) => /UNFULFILLED|PARTIALLY/.test(o.fulfillment || '') && hoursSince(o.createdAt) > 48).length;
  const shipOf = (o) => d.shipIndex.get(orderNumberKey(o.name));
  const winShip = {};
  for (const o of c.clean) { const s = shipOf(o); const k = s ? s.outcome : 'NOT IN SHIPROCKET'; winShip[k] = (winShip[k] || 0) + 1; }

  if (args.json) { console.log(JSON.stringify({ window: win, gross: c.gross, cancelled: c.cancelled.length, duplicates: c.duplicates.length, test: c.test.length + c.excluded.length, clean: c.clean.length, cleanRevenue: c.cleanRevenue, cod: { n: c.cod.length, revenue: c.codRevenue }, prepaid: { n: c.prepaid.length, revenue: c.prepaidRevenue }, unknownPayment: c.unknownPay.length, fulfillment: ful, unfulfilledOver48h: late, shiprocket: d.ship, windowShipments: winShip, rates: d.rates, spend, sources, warnings }, null, 2)); return; }

  console.log(`# Orders + RTO: ${win.label}${win.isToday ? ' (today so far)' : ''}\n`);
  console.log('## Orders (Shopify)');
  console.log(table(['', 'Orders', 'Value'], [
    ['Gross', c.gross, money(d.orders.reduce((a, o) => a + o.value, 0), cur)],
    ['Cancelled', c.cancelled.length, money(c.cancelled.reduce((a, o) => a + o.value, 0), cur)],
    ['Duplicate submissions', c.duplicates.length, money(c.duplicates.reduce((a, o) => a + o.value, 0), cur)],
    ['Test / excluded', c.test.length + c.excluded.length, ''],
    ['**Clean**', c.clean.length, money(c.cleanRevenue, cur)],
    ['COD', `${c.cod.length} (${pct(safeDiv(c.cod.length * 100, c.clean.length), 0)})`, money(c.codRevenue, cur)],
    ['Prepaid (online at checkout)', `${c.prepaid.length} (${pct(safeDiv(c.prepaid.length * 100, c.clean.length), 0)})`, money(c.prepaidRevenue, cur)],
    ...(c.unknownPay.length ? [['Payment type unknown', c.unknownPay.length, money(c.unknownPay.reduce((a, o) => a + o.value, 0), cur)]] : []),
  ]));
  console.log('\n"Prepaid" here means paid online at checkout (gateway match). A COD order that Shopify marks "Paid" after delivery is still COD.');
  if (spend != null) console.log(`Prepaid Day-0 recovery: ${money(c.prepaidRevenue, cur)} ÷ Meta spend ${money(spend, cur)} = **${pct(safeDiv(c.prepaidRevenue * 100, spend), 0)}** of this window's ad spend already in the bank.`);

  console.log('\n## Fulfilment (clean orders)');
  console.log(table(['Shopify status', 'Orders'], Object.entries(ful).map(([k, v]) => [k, v])));
  if (late) console.log(`⚠️ ${late} clean orders are unfulfilled for more than 48 hours.`);

  console.log('\n## RTO');
  if (d.ship) {
    const s = d.ship;
    console.log(table(['Shiprocket, last ' + cfg.rto.lookback_days + ' days', 'Shipments'], [
      ['Delivered', s.delivered], ['RTO (initiated or returned)', s.rto], ['In transit', s.inTransit], ['NDR (failed delivery attempt)', s.ndr],
      ['Not shipped yet', s.notShipped], ['Cancelled', s.cancelled],
      ['**RTO rate** (RTO ÷ delivered+RTO)', `${pct(s.rtoRate)} of ${s.closed} closed`],
      ['RTO rate COD', `${pct(s.rtoRateCod)} of ${s.closedCod}`], ['RTO rate prepaid', `${pct(s.rtoRatePrepaid)} of ${s.closedPrepaid}`],
      ['Avg forward charge', money(s.avgForward, cur)], ['Avg COD charge', money(s.avgCod, cur)], ['Avg RTO charge', money(s.avgRto, cur)],
    ]));
    console.log(`\nThis window's clean orders in Shiprocket: ${Object.entries(winShip).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
    if (s.ndr) console.log(`👉 ${s.ndr} shipments are in NDR. Calling these customers today is the cheapest way to cut RTO.`);
  } else {
    console.log('Shiprocket not connected, so RTO below is from Shopify tags or config:');
  }
  console.log(table(['Payment', 'RTO rate used', 'Source'], ['COD', 'PREPAID'].map((p) => [p, d.rates[p].rate == null ? 'n/a' : pct(d.rates[p].rate * 100), d.rates[p].from])));
  if (win.isToday) warnings.push('Orders placed today are not shipped yet; their RTO is unknown. RTO rates come from older shipments.');
  printWarnings(warnings);
  printSources(sources);
});
