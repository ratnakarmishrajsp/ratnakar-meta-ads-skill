// Shared data loading for the profit / product / orders jobs. Every source used is recorded in `sources`,
// every gap in `warnings`, so the report can say exactly where each number came from.
import { addDays, localToIso, num } from './cli.mjs';
import { has } from './env.mjs';
import { metaClient, purchases, purchaseValue } from './meta.mjs';
import { shopifyClient, fetchOrders, cleanOrders } from './shopify.mjs';
import { shiprocketClient, fetchShipments, indexByOrderNumber, rtoStats } from './shiprocket.mjs';
import { resolveRates, tagRtoRates } from './economics.mjs';

export async function loadMeta(creds, cfg, win, sources, warnings) {
  const meta = metaClient(creds);
  const acc = await meta.get(meta.account, { fields: 'name,currency,timezone_name,account_status,spend_cap,amount_spent' });
  if (acc.timezone_name && acc.timezone_name !== cfg.timezone) warnings.push(`Meta ad account timezone is ${acc.timezone_name} but config timezone is ${cfg.timezone}; daily Meta and Shopify numbers will not line up exactly.`);
  if (acc.currency && acc.currency !== cfg.currency) warnings.push(`Meta account currency is ${acc.currency}, config says ${cfg.currency}.`);
  const rows = await meta.insights('account', win.since, win.until, 'spend,impressions,inline_link_clicks,actions,action_values');
  const r = rows[0] || {};
  const totals = { spend: num(r.spend), purchases: purchases(r), revenue: purchaseValue(r), clicks: num(r.inline_link_clicks), impressions: num(r.impressions) };
  sources.push(`Meta Marketing API ${meta.version} — ad account insights ${win.label} (account timezone ${acc.timezone_name}, Meta's default attribution)`);
  return { meta, acc, totals };
}

export async function loadOrders(creds, cfg, win, sources, warnings, { lookback = true } = {}) {
  const tz = cfg.timezone;
  const shop = await shopifyClient(creds);
  const res = await fetchOrders(shop, localToIso(win.since, '00:00:00', tz), localToIso(win.until, '23:59:59', tz), warnings);
  const clean = cleanOrders(res.orders, cfg);
  sources.push(`Shopify Admin GraphQL ${res.apiVersion || shop.version} — orders created ${win.since} 00:00 → ${win.until} 23:59 (${tz}), ${res.orders.length} orders`);
  if (clean.noPhone) warnings.push(`${clean.noPhone} orders had no phone number, so they could not be checked for duplicates.`);
  if (clean.unknownPay.length) warnings.push(`${clean.unknownPay.length} orders have a payment gateway that is neither COD nor prepaid by the config regex (${[...new Set(clean.unknownPay.flatMap((o) => o.gateways))].join(', ') || 'none'}); treated as COD.`);
  if (shop.scopes && !shop.scopes.includes('read_all_orders') && win.since < addDays(win.today, -59)) warnings.push('Window starts more than 60 days ago and the app has no read_all_orders scope; Shopify only returns the last 60 days.');

  // Shipping outcomes and charges.
  let shipments = [], shipIndex = new Map(), ship = null, tagRates = null;
  const lb = cfg.rto.lookback_days || 30;
  if (has.shiprocket(creds) && cfg.rto.source !== 'config' && cfg.rto.source !== 'shopify') {
    const sr = await shiprocketClient(creds);
    const from = [win.since, addDays(win.today, -lb)].sort()[0];
    shipments = await fetchShipments(sr, from, win.today);
    shipIndex = indexByOrderNumber(shipments);
    ship = rtoStats(shipments);
    sources.push(`Shiprocket API — ${shipments.length} shipments created ${from} → ${win.today} (statuses, freight / COD / RTO charges)`);
  } else if (lookback && cfg.rto.source !== 'config' && (cfg.rto.shopify_rto_tags || []).length) {
    const lbRes = await fetchOrders(shop, localToIso(addDays(win.today, -lb), '00:00:00', tz), localToIso(win.today, '23:59:59', tz), []);
    const lbClean = cleanOrders(lbRes.orders, cfg);
    tagRates = tagRtoRates(lbClean.clean, cfg);
    sources.push(`Shopify tags ${JSON.stringify(cfg.rto.shopify_rto_tags)} on ${lbClean.clean.length} clean orders of the last ${lb} days (RTO rate fallback)`);
  }
  const rates = resolveRates(cfg, { ship, tagRates });
  for (const p of ['COD', 'PREPAID']) sources.push(`RTO rate ${p}: ${rates[p].rate == null ? 'n/a' : (rates[p].rate * 100).toFixed(1) + '%'} — ${rates[p].from}`);
  return { shop, orders: res.orders, clean, shipments, shipIndex, ship, rates };
}
