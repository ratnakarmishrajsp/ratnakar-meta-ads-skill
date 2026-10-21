// Shopify Admin GraphQL client (read-only) + "clean order" logic.
// Auth: Dev Dashboard app → client-credentials grant (24 h token), or a legacy custom-app token (shpat_…).
import crypto from 'node:crypto';
import { fail, num } from './cli.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function shopifyClient(creds) {
  const s = creds.shopify;
  if (!s.domain) fail('Shopify is not configured.', 'Set SHOPIFY_STORE_DOMAIN (yourstore.myshopify.com) in .env (SETUP.md step 3).');
  let token = '';
  let scopes = null;
  if (s.clientId && s.clientSecret) {
    const res = await fetch(`https://${s.domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: s.clientId, client_secret: s.clientSecret }),
    });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch {
      const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || `HTTP ${res.status}`;
      fail(`Shopify login failed: ${title.trim()}`, 'Check SHOPIFY_STORE_DOMAIN, client ID/secret, that the app is installed on the store and that app + store are in the same Shopify organization.');
    }
    if (!j.access_token) fail(`Shopify login failed: ${j.error_description || j.error || 'no token returned'}`, 'Check the client ID/secret in the Dev Dashboard app settings.');
    token = j.access_token;
    scopes = (j.scope || '').split(',').filter(Boolean);
  } else if (s.accessToken) {
    token = s.accessToken;
  } else fail('Shopify credentials missing.', 'Set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard app) or SHOPIFY_ACCESS_TOKEN (old custom app).');

  async function gql(query, variables = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://${s.domain}/admin/api/${s.version}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401 || res.status === 403) fail(`Shopify API refused access (HTTP ${res.status}).`, 'The app needs the read_orders scope and must be installed on this store.');
      if (res.status === 429 || res.status >= 500) { if (attempt < 4) { await sleep(2000 * (attempt + 1)); continue; } fail(`Shopify API HTTP ${res.status}`); }
      const j = await res.json();
      const throttled = (j.errors || []).some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < 5) { await sleep(3000); continue; }
      const avail = j.extensions?.cost?.throttleStatus?.currentlyAvailable;
      if (avail != null && avail < 200) await sleep(1500);
      return { ...j, apiVersion: res.headers.get('x-shopify-api-version') };
    }
  }
  return { domain: s.domain, version: s.version, scopes, gql };
}

// Optional parts are dropped automatically (with a warning) if the app lacks access to them.
const OPTIONAL = {
  phone: 'phone shippingAddress { phone }',
  product: 'product { handle }',
  journey: 'customerJourneySummary { lastVisit { source utmParameters { source medium campaign } } }',
};

function orderQuery(parts) {
  return `query Orders($q: String!, $after: String) {
  orders(first: 40, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt test tags
      displayFinancialStatus displayFulfillmentStatus returnStatus
      paymentGatewayNames
      ${parts.includes('phone') ? OPTIONAL.phone : ''}
      ${parts.includes('journey') ? OPTIONAL.journey : ''}
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount } }
      lineItems(first: 15) { nodes {
        name quantity sku variant { sku }
        ${parts.includes('product') ? OPTIONAL.product : ''}
        discountedTotalSet { shopMoney { amount } }
      } }
    }
  }
}`;
}

export async function fetchOrders(shop, sinceIso, untilIso, warnings = []) {
  let parts = Object.keys(OPTIONAL);
  const q = `created_at:>='${sinceIso}' AND created_at:<='${untilIso}'`;
  for (let tries = 0; tries <= Object.keys(OPTIONAL).length; tries++) {
    const orders = [];
    let after = null;
    let denied = null;
    let apiVersion = null;
    for (let page = 0; page < 200; page++) {
      const j = await shop.gql(orderQuery(parts), { q, after });
      apiVersion = j.apiVersion;
      if (j.errors?.length) {
        denied = deniedPart(j.errors, parts);
        if (denied) break;
        fail(`Shopify GraphQL error: ${j.errors.map((e) => e.message).join('; ')}`);
      }
      const con = j.data.orders;
      orders.push(...con.nodes);
      if (!con.pageInfo.hasNextPage) break;
      after = con.pageInfo.endCursor;
    }
    if (!denied) return { orders: orders.map(normalize), parts, apiVersion };
    warnings.push({
      phone: 'Shopify did not return customer phone numbers (protected customer data not granted), so duplicate orders could NOT be removed.',
      product: 'Shopify did not return product handles (no read_products scope); products are matched by SKU/title only.',
      journey: 'Shopify did not return UTM / visit data, so "orders Shopify credits to Meta" is not available.',
    }[denied]);
    parts = parts.filter((p) => p !== denied);
  }
  fail('Shopify order query kept failing after removing optional fields.');
}

function deniedPart(errors, parts) {
  for (const e of errors) {
    const s = `${(e.path || []).join('.')} ${e.message}`;
    if (parts.includes('journey') && /customerJourney/i.test(s)) return 'journey';
    if (parts.includes('product') && /(^|\.)product(\.|\s|$)|read_products/i.test(s)) return 'product';
    if (parts.includes('phone') && /phone|shippingAddress|customer object|protected customer/i.test(s)) return 'phone';
  }
  return null;
}

function normalize(o) {
  const lines = o.lineItems.nodes.map((li) => ({
    name: li.name, quantity: li.quantity, sku: li.sku || li.variant?.sku || '', handle: li.product?.handle || '',
    value: num(li.discountedTotalSet?.shopMoney?.amount),
  }));
  const utm = o.customerJourneySummary?.lastVisit?.utmParameters;
  return {
    id: o.id, name: o.name, createdAt: o.createdAt, cancelledAt: o.cancelledAt, test: o.test, tags: o.tags || [],
    financial: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus, returnStatus: o.returnStatus,
    gateways: o.paymentGatewayNames || [],
    phoneKey: phoneKey(o.phone || o.shippingAddress?.phone),
    value: num(o.currentTotalPriceSet?.shopMoney?.amount), currency: o.currentTotalPriceSet?.shopMoney?.currencyCode,
    tax: num(o.totalTaxSet?.shopMoney?.amount),
    lines,
    utmSource: (utm?.source || o.customerJourneySummary?.lastVisit?.source || '').toLowerCase(),
  };
}
// Phone numbers are only kept as a one-way hash (last 10 digits) for duplicate checks; never printed.
function phoneKey(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? crypto.createHash('sha256').update(d).digest('hex').slice(0, 16) : null;
}

export function paymentType(o, cfg) {
  const cod = new RegExp(cfg.orders.cod_gateway_regex, 'i');
  const pre = new RegExp(cfg.orders.prepaid_gateway_regex, 'i');
  if (o.gateways.some((g) => cod.test(g))) return 'COD';
  if (o.gateways.some((g) => pre.test(g))) return 'PREPAID';
  return 'UNKNOWN';
}

// Clean = not test, not cancelled, not tagged as excluded, not a duplicate submission
// (same phone + same items within duplicate_window_hours; the first one is kept).
export function cleanOrders(orders, cfg) {
  const exclude = new Set((cfg.orders.exclude_tags || []).map((t) => t.toLowerCase()));
  const windowMs = (cfg.orders.duplicate_window_hours || 24) * 3600e3;
  const r = { gross: orders.length, test: [], cancelled: [], excluded: [], duplicates: [], clean: [], noPhone: 0 };
  const seen = new Map();
  for (const o of [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    o.payment = paymentType(o, cfg);
    if (o.test) { r.test.push(o); continue; }
    if (o.cancelledAt) { r.cancelled.push(o); continue; }
    if (o.tags.some((t) => exclude.has(t.toLowerCase()))) { r.excluded.push(o); continue; }
    if (!o.phoneKey) { r.noPhone++; r.clean.push(o); continue; }
    const sig = o.lines.map((l) => `${l.name}×${l.quantity}`).sort().join('|');
    const prev = seen.get(o.phoneKey) || [];
    const t = Date.parse(o.createdAt);
    if (prev.some((p) => p.sig === sig && t - p.t <= windowMs)) { r.duplicates.push(o); continue; }
    prev.push({ sig, t });
    seen.set(o.phoneKey, prev);
    r.clean.push(o);
  }
  const sum = (a) => a.reduce((s, o) => s + o.value, 0);
  r.cleanRevenue = sum(r.clean);
  r.cod = r.clean.filter((o) => o.payment === 'COD');
  r.prepaid = r.clean.filter((o) => o.payment === 'PREPAID');
  r.unknownPay = r.clean.filter((o) => o.payment === 'UNKNOWN');
  r.codRevenue = sum(r.cod);
  r.prepaidRevenue = sum(r.prepaid);
  return r;
}

export function matchProduct(line, cfg) {
  const t = line.name.toLowerCase();
  return (cfg.products || []).find((p) =>
    (line.handle && (p.handles || []).includes(line.handle))
    || (line.sku && (p.skus || []).includes(line.sku))
    || (p.title_contains || []).some((s) => t.includes(String(s).toLowerCase()))) || null;
}

export function isFromMeta(o) { return /facebook|instagram|^fb|^ig|meta/.test(o.utmSource); }
