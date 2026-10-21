// Job 4: "Profit by product?" Per-product P&L and break-even ROAS. Read-only.
// Ad spend is assigned to a product by the ad's landing page (/products/<handle>) or config.campaign_product_map.
// Usage: node scripts/profit_by_product.mjs [--days 7 (default) | --since .. --until .. | --date ..] [--json]
import { parseArgs, run, resolveWindow, money, ratio, cut, table, printSources, printWarnings, safeDiv } from './lib/cli.mjs';
import { loadEnv, readCreds } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { loadMeta, loadOrders } from './lib/data.mjs';
import { AD_FIELDS, rollup } from './lib/meta.mjs';
import { orderEconomics, metaGstFactor, lineCost } from './lib/economics.mjs';
import { matchProduct } from './lib/shopify.mjs';
import { orderNumberKey } from './lib/shiprocket.mjs';

const PARTS = ['revenue', 'salesGst', 'rtoLostSales', 'productCost', 'forwardShipping', 'rtoShipping', 'codFees', 'gatewayFees', 'contribution'];

function linkOf(cr = {}) {
  const s = cr.object_story_spec || {};
  return s.link_data?.link || s.link_data?.call_to_action?.value?.link || s.video_data?.call_to_action?.value?.link
    || cr.asset_feed_spec?.link_urls?.[0]?.website_url || cr.link_url || null;
}

run(async () => {
  const args = parseArgs();
  loadEnv(args.env);
  const creds = readCreds();
  const cfg = loadConfig(args, { required: true });
  const win = resolveWindow(args, cfg.timezone, 7);
  const cur = cfg.currency;
  const sources = [`Costs and products: ${cfg._file}`], warnings = [];
  const { meta } = await loadMeta(creds, cfg, win, sources, warnings);
  const d = await loadOrders(creds, cfg, win, sources, warnings);
  const gf = metaGstFactor(cfg);

  const P = new Map();
  const bucket = (name) => { if (!P.has(name)) P.set(name, { name, orders: new Set(), units: 0, ...Object.fromEntries(PARTS.map((k) => [k, 0])), spend: 0, metaPurchases: 0, metaRevenue: 0, missing: new Set() }); return P.get(name); };

  // ---- Shopify side: split each order's economics across its line items ----
  for (const o of d.clean.clean) {
    const e = orderEconomics(o, cfg, d.rates, d.shipIndex.get(orderNumberKey(o.name)));
    const lineTotal = o.lines.reduce((s, l) => s + l.value, 0);
    const qtyTotal = o.lines.reduce((s, l) => s + l.quantity, 0) || 1;
    const costs = o.lines.map((l) => lineCost(l, cfg));
    const costTotal = costs.reduce((s, c) => s + (c || 0), 0);
    o.lines.forEach((l, i) => {
      const p = matchProduct(l, cfg);
      const b = bucket(p ? p.name : `Unmapped: ${cut(l.name, 40)}`);
      b.orders.add(o.id); b.units += l.quantity;
      if (e.missing.length) { e.missing.forEach((m) => b.missing.add(m)); return; }
      const share = lineTotal ? l.value / lineTotal : l.quantity / qtyTotal;
      for (const k of PARTS) b[k] += k === 'productCost' && costTotal ? e.parts[k] * ((costs[i] || 0) / costTotal) : e.parts[k] * share;
    });
  }
  // contribution must stay consistent after the cost-share split
  for (const b of P.values()) b.contribution = b.revenue - b.salesGst - b.rtoLostSales - b.productCost - b.forwardShipping - b.rtoShipping - b.codFees - b.gatewayFees;

  // ---- Meta side: spend per ad → landing page → product ----
  const rows = await meta.insights('ad', win.since, win.until, AD_FIELDS);
  const ads = rollup(rows).ad.filter((a) => a.spend > 0);
  const creatives = new Map();
  for (const o of await meta.byIds('ads', ads.map((a) => a.id), 'id,creative{object_story_spec,asset_feed_spec{link_urls},link_url,effective_object_story_id}')) creatives.set(o.id, o.creative || {});
  let pageTok = null;
  const postLinks = new Map();
  const assign = { product: 0, storeWide: 0, unmapped: 0 };
  const unmappedAds = [];
  for (const a of ads) {
    const cr = creatives.get(a.id) || {};
    let link = linkOf(cr);
    if (!link && cr.effective_object_story_id && creds.meta.pageId) { // ads that reuse an existing post
      try {
        pageTok ??= await meta.pageToken(creds.meta.pageId);
        if (!postLinks.has(cr.effective_object_story_id)) postLinks.set(cr.effective_object_story_id, (await meta.get(cr.effective_object_story_id, { fields: 'call_to_action' }, pageTok)).call_to_action?.value?.link || null);
        link = postLinks.get(cr.effective_object_story_id);
      } catch { /* falls through to the name map */ }
    }
    let product = null;
    const handle = link && decodeURIComponent((link.match(/\/products\/([^/?#]+)/) || [])[1] || '');
    if (handle) product = (cfg.products || []).find((p) => (p.handles || []).includes(handle));
    if (!product) {
      const rule = (cfg.campaign_product_map || []).find((r) => a.name?.toLowerCase().includes(String(r.ad_name_contains || '\u0000').toLowerCase())
        || rows.find((x) => x.ad_id === a.id)?.campaign_name?.toLowerCase().includes(String(r.campaign_name_contains || '\u0000').toLowerCase()));
      if (rule) product = (cfg.products || []).find((p) => p.name === rule.product);
    }
    let b;
    if (product) { b = bucket(product.name); assign.product += a.spend; }
    else if (link && !handle) { b = bucket('Store-wide ads (home / collection pages)'); assign.storeWide += a.spend; }
    else { b = bucket('Ads not linked to a known product'); assign.unmapped += a.spend; unmappedAds.push(`${cut(a.name, 40)} → ${handle ? `/products/${handle} (handle not in config)` : 'no link found'}`); }
    b.spend += a.spend; b.metaPurchases += a.purchases; b.metaRevenue += a.revenue;
  }
  sources.push(`Meta ad-level insights ${win.label}: ${ads.length} ads with spend, mapped by landing page (/products/<handle>) and config.campaign_product_map`);

  const list = [...P.values()].map((b) => {
    const adCost = b.spend * gf;
    const ok = !b.missing.size;
    const net = ok ? b.contribution - adCost : null;
    const be = ok && b.contribution > 0 ? (b.revenue * gf) / b.contribution : null;
    const metaRoas = safeDiv(b.metaRevenue, b.spend);
    let verdict = !ok ? '❓ missing cost data'
      : !b.spend ? (b.contribution > 0 ? '🟢 earns (no ad spend)' : '🔴 loses even without ads')
      : net > 0 ? '🟢 EARNING'
      : metaRoas != null && be != null && metaRoas >= be ? '🔴 QUIETLY LOSING (Meta ROAS looks fine)'
      : '🔴 LOSING';
    if (!b.revenue && b.spend) verdict = '🔴 SPEND, NO CLEAN ORDERS';
    return { ...b, orders: b.orders.size, adCost, net, breakEvenRoas: be, cleanRoas: safeDiv(b.revenue, b.spend), metaRoas, aov: safeDiv(b.revenue, b.orders.size), verdict, missing: [...b.missing] };
  }).sort((x, y) => (y.net ?? -1e12) - (x.net ?? -1e12));

  if (args.json) { console.log(JSON.stringify({ window: win, products: list, assign, unmappedAds, rates: d.rates, sources, warnings }, null, 2)); return; }

  console.log(`# Profit by product: ${win.label}\n`);
  console.log(table(['Product', 'Orders', 'Units', 'Clean revenue', 'Contribution', 'Ad spend', 'Meta ROAS', 'Clean ROAS', 'Break-even', 'Net P&L', 'Verdict'],
    list.map((b) => [cut(b.name, 42), b.orders, b.units, money(b.revenue, cur), money(b.contribution, cur), money(b.spend, cur), ratio(b.metaRoas), ratio(b.cleanRoas), ratio(b.breakEvenRoas), b.net == null ? 'n/a' : money(b.net, cur), b.verdict])));
  const tot = list.reduce((s, b) => ({ c: s.c + (b.net == null ? 0 : b.contribution), a: s.a + b.adCost }), { c: 0, a: 0 });
  console.log(`\nTotal: contribution ${money(tot.c, cur)} − ad cost ${money(tot.a, cur)} = **${money(tot.c - tot.a, cur)}**`);
  console.log(`Ad spend assignment: products ${money(assign.product, cur)} | store-wide ${money(assign.storeWide, cur)} | unknown ${money(assign.unmapped, cur)}`);
  if (unmappedAds.length) console.log('\nAds not linked to a product (add the handle to config.products or use campaign_product_map):\n' + unmappedAds.slice(0, 15).map((x) => `- ${x}`).join('\n'));
  console.log('\nHow to read it: Clean ROAS uses ALL clean Shopify revenue of that product (also organic orders); Meta ROAS uses Meta-reported purchases only. "Quietly losing" = Ads Manager looks above break-even but real orders after costs do not cover the ads.');
  for (const b of list) if (b.missing.length) warnings.push(`${b.name}: missing ${b.missing.join('; ')}`);
  printWarnings(warnings);
  printSources(sources);
});
