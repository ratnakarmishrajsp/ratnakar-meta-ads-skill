// Unit economics for COD-heavy D2C. Formulas are explained in references/formulas.md.
// Rule: an RTO order brings no revenue, the product comes back, and you pay forward + return shipping.
import { matchProduct } from './shopify.mjs';

export const metaGstFactor = (cfg) => (cfg.gst.claim_meta_gst_credit ? 1 : 1 + (cfg.gst.meta_gst_pct || 0) / 100);

export function lineCost(line, cfg) {
  const p = matchProduct(line, cfg);
  const unit = p ? p.cost : cfg.default_product_cost;
  return unit == null ? null : unit * line.quantity;
}

// Pick the RTO rates to use and say where they came from.
export function resolveRates(cfg, { ship = null, tagRates = null } = {}) {
  const src = cfg.rto.source || 'auto';
  const min = cfg.rto.min_closed_shipments || 20;
  const fromCfg = (k) => (cfg.rto[k] == null ? null : cfg.rto[k] / 100);
  const pick = (pay, srRate, srN, tagRate, tagN) => {
    if ((src === 'auto' || src === 'shiprocket') && srRate != null && srN >= min) return { rate: srRate / 100, from: `Shiprocket: ${srN} closed ${pay} shipments in the last ${cfg.rto.lookback_days} days` };
    if ((src === 'auto' || src === 'shopify') && tagRate != null && tagN >= min) return { rate: tagRate / 100, from: `Shopify tags ${JSON.stringify(cfg.rto.shopify_rto_tags)}: ${tagN} fulfilled ${pay} orders` };
    const c = fromCfg(pay === 'COD' ? 'cod_rate_pct' : 'prepaid_rate_pct');
    const why = srRate != null && srN < min ? ` (Shiprocket had only ${srN} closed ${pay} shipments, below min_closed_shipments ${min})` : '';
    return c == null ? { rate: null, from: `MISSING: set rto.${pay === 'COD' ? 'cod' : 'prepaid'}_rate_pct in config${why}` }
      : { rate: c, from: `config rto.${pay === 'COD' ? 'cod' : 'prepaid'}_rate_pct = ${c * 100}% (assumption${why})` };
  };
  return {
    COD: pick('COD', ship?.rtoRateCod, ship?.closedCod || 0, tagRates?.COD?.rate, tagRates?.COD?.n || 0),
    PREPAID: pick('PREPAID', ship?.rtoRatePrepaid, ship?.closedPrepaid || 0, tagRates?.PREPAID?.rate, tagRates?.PREPAID?.n || 0),
  };
}

// Shopify-tag RTO rate: orders carrying an RTO tag ÷ fulfilled orders, per payment type.
export function tagRtoRates(orders, cfg) {
  const tags = new Set((cfg.rto.shopify_rto_tags || []).map((t) => t.toLowerCase()));
  if (!tags.size) return null;
  const out = {};
  for (const pay of ['COD', 'PREPAID']) {
    const f = orders.filter((o) => o.payment === pay && !o.cancelledAt && /FULFILLED/.test(o.fulfillment || ''));
    const rto = f.filter((o) => o.tags.some((t) => tags.has(t.toLowerCase())) || o.returnStatus === 'RETURNED');
    out[pay] = { n: f.length, rate: f.length ? (rto.length / f.length) * 100 : null };
  }
  return out;
}

// One clean order → expected (or actual, if Shiprocket knows the outcome) contribution before ads.
export function orderEconomics(o, cfg, rates, shipment = null) {
  const pay = o.payment === 'PREPAID' ? 'PREPAID' : 'COD'; // UNKNOWN is treated as COD (the riskier case)
  let r = rates[pay].rate;
  let outcome = 'expected';
  if (shipment?.outcome === 'DELIVERED') { r = 0; outcome = 'delivered'; }
  else if (shipment?.outcome === 'RTO') { r = 1; outcome = 'rto'; }
  const missing = [];
  if (r == null) missing.push(`RTO rate (${pay})`);
  const g = cfg.gst;
  const gst = g.sales_gst_registered ? (o.tax > 0 ? o.tax : g.prices_include_gst ? (o.value * g.sales_gst_pct) / (100 + g.sales_gst_pct) : 0) : 0;
  const net = o.value - gst;
  let cogs = 0;
  for (const l of o.lines) { const c = lineCost(l, cfg); if (c == null) { missing.push(`cost of "${l.name}"`); } else cogs += c; }
  const useSr = cfg.shipping.use_shiprocket_actuals && shipment;
  const srGst = 1 + (cfg.shipping.shiprocket_add_gst_pct || 0) / 100;
  const fwd = useSr && shipment.forward ? shipment.forward * srGst : cfg.shipping.forward_per_order;
  const back = useSr && shipment.rto ? shipment.rto * srGst : cfg.shipping.rto_return_per_order;
  const codFee = pay === 'COD' ? (useSr && shipment.cod ? shipment.cod * srGst : (cfg.cod_fee.flat || 0) + (o.value * (cfg.cod_fee.pct_of_order || 0)) / 100) : 0;
  const pgFee = pay === 'PREPAID' ? (o.value * (cfg.payment_gateway_fee_pct || 0)) / 100 : 0;
  if (fwd == null) missing.push('shipping.forward_per_order');
  if (back == null && (r || 0) > 0) missing.push('shipping.rto_return_per_order');
  if (missing.length) return { missing, outcome, pay };
  const rr = r || 0;
  const parts = {
    revenue: o.value,
    salesGst: gst,
    rtoLostSales: rr * net,
    productCost: (1 - rr) * cogs + rr * (cfg.shipping.rto_packaging_loss || 0),
    forwardShipping: fwd,
    rtoShipping: rr * (back || 0),
    codFees: (1 - rr) * codFee + (cfg.cod_fee.charged_on_rto ? rr * codFee : 0),
    gatewayFees: pgFee,
  };
  parts.contribution = parts.revenue - parts.salesGst - parts.rtoLostSales - parts.productCost - parts.forwardShipping
    - parts.rtoShipping - parts.codFees - parts.gatewayFees;
  return { parts, outcome, pay, rto: rr, missing: [] };
}

export function sumEconomics(list) {
  const keys = ['revenue', 'salesGst', 'rtoLostSales', 'productCost', 'forwardShipping', 'rtoShipping', 'codFees', 'gatewayFees', 'contribution'];
  const t = Object.fromEntries(keys.map((k) => [k, 0]));
  const missing = new Set();
  let n = 0;
  const outcomes = { expected: 0, delivered: 0, rto: 0 };
  for (const e of list) {
    outcomes[e.outcome]++;
    if (e.missing.length) { e.missing.forEach((m) => missing.add(m)); continue; }
    n++;
    for (const k of keys) t[k] += e.parts[k];
  }
  return { ...t, orders: n, missing: [...missing], outcomes };
}

// Revenue ÷ ad spend (ex-GST, as Meta shows it) at which profit is exactly zero.
export function breakEven(sum, cfg) {
  if (!sum.orders || sum.contribution <= 0) return { roas: null, cpa: null, perOrder: sum.orders ? sum.contribution / sum.orders : null };
  const perOrder = sum.contribution / sum.orders;
  return { roas: (sum.revenue * metaGstFactor(cfg)) / sum.contribution, cpa: perOrder / metaGstFactor(cfg), perOrder };
}

// A typical order built only from config (used when there is no Shopify data, e.g. the Meta-only report).
export function typicalBreakEven(cfg, aov) {
  const cost = cfg.default_product_cost ?? avg((cfg.products || []).map((p) => p.cost));
  const share = cfg.assumptions.cod_share_pct;
  if (!aov || cost == null || share == null) return { roas: null, why: !aov ? 'no AOV (no purchases and no assumptions.aov)' : cost == null ? 'no product costs in config' : 'assumptions.cod_share_pct not set' };
  const rates = resolveRates(cfg);
  const mk = (payment) => ({ payment, value: aov, tax: 0, lines: [{ name: '_typical', quantity: 1, sku: '', handle: '' }] });
  const cfg2 = { ...cfg, default_product_cost: cost, products: [] };
  const list = [];
  const codN = Math.round(share), preN = 100 - codN;
  const codE = orderEconomics(mk('COD'), cfg2, rates), preE = orderEconomics(mk('PREPAID'), cfg2, rates);
  for (let i = 0; i < codN; i++) list.push(codE);
  for (let i = 0; i < preN; i++) list.push(preE);
  const s = sumEconomics(list);
  if (s.missing.length) return { roas: null, why: 'missing ' + s.missing.join(', ') };
  return { ...breakEven(s, cfg), why: `config costs, AOV ${Math.round(aov)}, COD share ${share}%, RTO ${rates.COD.rate * 100}% COD / ${rates.PREPAID.rate * 100}% prepaid` };
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
