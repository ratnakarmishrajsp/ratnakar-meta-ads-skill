// Shiprocket (optional, read-only): real shipping / COD / RTO charges and delivery outcomes.
// Auth: an API user (Shiprocket → Settings → API → Create API User) → POST /auth/login → Bearer token (~10 days).
// Customer details in the response are never printed or stored; only statuses and charges are used.
import { fail, num } from './cli.mjs';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

export async function shiprocketClient(creds) {
  const { email, password } = creds.shiprocket;
  if (!email || !password) fail('Shiprocket is not configured.', 'Optional: set SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD of a Shiprocket API user (SETUP.md step 4).');
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.token) fail(`Shiprocket login failed (HTTP ${res.status}): ${j.message || 'no token'}`, 'Use the API user email/password (not your normal panel login); the password is emailed to your main account when you create the API user.');
  const H = { Authorization: `Bearer ${j.token}` };
  return {
    async get(path) {
      const r = await fetch(`${BASE}${path}`, { headers: H });
      if (!r.ok) fail(`Shiprocket API ${path.split('?')[0]} HTTP ${r.status}`);
      return r.json();
    },
  };
}

// Orders created between two dates (YYYY-MM-DD, inclusive), normalised to what the skill needs.
export async function fetchShipments(sr, from, to, maxPages = 60) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const j = await sr.get(`/orders?per_page=100&page=${page}&from=${from}&to=${to}`);
    out.push(...(j.data || []).map(normalize));
    if (page >= (j.meta?.pagination?.total_pages || 1)) break;
  }
  return out;
}

function normalize(o) {
  const st = String(o.status || '').toUpperCase();
  const sh = (o.shipments || [])[0] || {};
  const ch = o.awb_data?.charges || {};
  // Empty RTO dates come back as placeholder strings, so only a real date counts.
  const realDate = (v) => !!v && Date.parse(String(v).replace(' ', 'T')) > Date.parse('2001-01-01');
  const isRto = st.includes('RTO') || realDate(sh.rto_initiated_date) || realDate(sh.rto_delivered_date);
  return {
    keys: [o.channel_order_id, o.others?.name].filter(Boolean).map((k) => String(k).replace(/\D/g, '')).filter(Boolean),
    payment: String(o.payment_method || '').toLowerCase() === 'prepaid' ? 'PREPAID' : 'COD',
    status: st,
    outcome: isRto ? 'RTO'
      : st === 'DELIVERED' ? 'DELIVERED'
      : st.includes('CANCEL') ? 'CANCELLED'
      : /LOST|DAMAGED|DESTROYED|DISPOSED/.test(st) ? 'LOST'
      : /^UNDELIVERED|NDR/.test(st) ? 'NDR'
      : ['NEW', 'INVOICED', 'READY TO SHIP', 'PICKUP SCHEDULED', 'OUT FOR PICKUP', 'AWB ASSIGNED', 'PICKUP GENERATED', 'LABEL GENERATED'].includes(st) ? 'NOT_SHIPPED'
      : 'IN_TRANSIT',
    forward: num(ch.charged_weight_amount) || num(ch.applied_weight_amount) || num(ch.freight_charges) || num(sh.shipping_charges) || null,
    cod: num(ch.cod_charges) || null,
    rto: num(ch.charged_weight_amount_rto) || num(ch.applied_weight_amount_rto) || null,
  };
}

export function indexByOrderNumber(shipments) {
  const m = new Map();
  for (const s of shipments) for (const k of s.keys) if (!m.has(k)) m.set(k, s);
  return m;
}
export const orderNumberKey = (shopifyName) => String(shopifyName || '').replace(/\D/g, '');

export function rtoStats(shipments) {
  const c = (f) => shipments.filter(f).length;
  const closed = (p) => shipments.filter((s) => (!p || s.payment === p) && (s.outcome === 'DELIVERED' || s.outcome === 'RTO'));
  const rate = (p) => { const cl = closed(p); return cl.length ? (cl.filter((s) => s.outcome === 'RTO').length / cl.length) * 100 : null; };
  const avg = (key, f = () => true) => { const v = shipments.filter((s) => f(s) && s[key] > 0).map((s) => s[key]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return {
    total: shipments.length,
    delivered: c((s) => s.outcome === 'DELIVERED'),
    rto: c((s) => s.outcome === 'RTO'),
    inTransit: c((s) => s.outcome === 'IN_TRANSIT'),
    ndr: c((s) => s.outcome === 'NDR'),
    notShipped: c((s) => s.outcome === 'NOT_SHIPPED'),
    cancelled: c((s) => s.outcome === 'CANCELLED'),
    closed: closed().length,
    closedCod: closed('COD').length,
    closedPrepaid: closed('PREPAID').length,
    rtoRate: rate(), rtoRateCod: rate('COD'), rtoRatePrepaid: rate('PREPAID'),
    avgForward: avg('forward'), avgCod: avg('cod'), avgRto: avg('rto', (s) => s.outcome === 'RTO'),
  };
}
