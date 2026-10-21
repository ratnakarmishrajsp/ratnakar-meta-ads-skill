// Meta Marketing / Graph API client (native fetch). Read calls are free; write calls are blocked
// unless the script explicitly unlocks them after the user's approval (--execute).
import { fail, num, redact } from './cli.mjs';

const RETRY_CODES = new Set([1, 2, 4, 17, 32, 613, 80000, 80003, 80004, 80014]);
const ALL_STATUSES = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED',
  'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function metaClient(creds) {
  const { token, account, version } = creds.meta;
  if (!token || !account) fail('Meta is not configured.', 'Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in .env (see SETUP.md step 2).');
  const base = `https://graph.facebook.com/${version}`;
  let writesUnlocked = false;

  async function call(method, pathOrUrl, params = {}, tok = token) {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${base}/${pathOrUrl.replace(/^\//, '')}`);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (method === 'GET') url.searchParams.set(k, s); else body.set(k, s);
    }
    if (!url.searchParams.has('access_token')) {
      if (method === 'GET') url.searchParams.set('access_token', tok); else body.set('access_token', tok);
    }
    for (let attempt = 0; ; attempt++) {
      let res, j;
      try {
        res = await fetch(url, method === 'GET' ? {} : { method, body });
        j = await res.json();
      } catch (e) {
        if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        fail(`Meta API network error: ${e.message}`);
      }
      if (!j.error) return j;
      const er = j.error;
      if (RETRY_CODES.has(er.code) && attempt < 3) { await sleep(5000 * (attempt + 1)); continue; }
      const e = new Error(redact(`Meta API error ${er.code}${er.error_subcode ? '/' + er.error_subcode : ''}: ${er.error_user_msg || er.message}`));
      e.code = er.code;
      e.hint = er.code === 190 ? 'Token expired or invalid. Create a new System User token (SETUP.md step 2).'
        : er.code === 10 || er.code === 200 ? 'The token is missing a permission or the asset is not assigned to the system user (SETUP.md step 2).'
        : er.code === 100 ? 'An ID or field is wrong. Check META_AD_ACCOUNT_ID / META_PAGE_ID / META_PIXEL_ID.' : undefined;
      throw e;
    }
  }

  const client = {
    base, account, version,
    get: (p, params, tok) => call('GET', p, params, tok),
    async getAll(p, params = {}, { maxPages = 50, tok } = {}) {
      const rows = [];
      let j = await call('GET', p, { limit: 200, ...params }, tok);
      for (let i = 0; ; i++) {
        rows.push(...(j.data || []));
        if (!j.paging?.next || i >= maxPages) break;
        j = await call('GET', j.paging.next, {}, tok);
      }
      return rows;
    },
    // Several objects by ID through the account edge (the `ids=` parameter was removed in v26).
    async byIds(edge, ids, fields) {
      const out = [];
      for (let i = 0; i < ids.length; i += 50) {
        out.push(...await client.getAll(`${account}/${edge}`, { fields, filtering: [
          { field: 'id', operator: 'IN', value: ids.slice(i, i + 50) },
          { field: 'effective_status', operator: 'IN', value: ALL_STATUSES },
        ] }));
      }
      return out;
    },
    // Only used after the user approved the exact change.
    unlockWrites() { writesUnlocked = true; },
    async post(p, params, tok) {
      if (!writesUnlocked) throw new Error('Safety stop: a write was attempted without --execute. Nothing was sent.');
      return call('POST', p, params, tok);
    },
    // Meta's own dry run: validates the payload, creates nothing.
    validateOnly: (p, params) => call('POST', p, { ...params, execution_options: ['validate_only'] }),

    async insights(level, since, until, fields, extra = {}) {
      return client.getAll(`${account}/insights`, {
        level, fields, time_range: { since, until }, limit: 500, ...extra,
      });
    },
    async pageToken(pageId) {
      const j = await call('GET', pageId, { fields: 'access_token' });
      if (!j.access_token) fail(`Could not get a Page token for Page ${pageId}.`, 'Assign the Page to the system user (Full control or Moderate task) and add pages_show_list.');
      return j.access_token;
    },
  };
  return client;
}

// Meta reports several purchase action types; use the first one present so nothing is counted twice.
const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
export function purchases(row) {
  for (const t of PURCHASE_TYPES) { const a = (row.actions || []).find((x) => x.action_type === t); if (a) return num(a.value); }
  return 0;
}
export function purchaseValue(row) {
  for (const t of PURCHASE_TYPES) { const a = (row.action_values || []).find((x) => x.action_type === t); if (a) return num(a.value); }
  return 0;
}
export function action(row, type) { return num((row.actions || []).find((x) => x.action_type === type)?.value); }

export const AD_FIELDS = 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,inline_link_clicks,actions,action_values';

// Sum ad-level insight rows into ad / ad set / campaign buckets.
export function rollup(rows) {
  const levels = { campaign: new Map(), adset: new Map(), ad: new Map() };
  const total = blank('ACCOUNT', 'Account total');
  for (const r of rows) {
    const keys = { campaign: [r.campaign_id, r.campaign_name], adset: [r.adset_id, r.adset_name], ad: [r.ad_id, r.ad_name] };
    for (const [lvl, [id, name]] of Object.entries(keys)) {
      if (!levels[lvl].has(id)) levels[lvl].set(id, { ...blank(id, name), campaign_id: r.campaign_id, adset_id: r.adset_id });
      add(levels[lvl].get(id), r);
    }
    add(total, r);
  }
  return { ...Object.fromEntries(Object.entries(levels).map(([k, m]) => [k, [...m.values()]])), total };
}
// One insights row (any level) → a summed bucket.
export function rowToBucket(r, id, name) { const b = blank(id, name); add(b, r); return b; }
function blank(id, name) { return { id, name, spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0, atc: 0, ic: 0 }; }
function add(b, r) {
  b.spend += num(r.spend); b.impressions += num(r.impressions); b.clicks += num(r.inline_link_clicks);
  b.purchases += purchases(r); b.revenue += purchaseValue(r);
  b.atc += action(r, 'add_to_cart') || action(r, 'omni_add_to_cart');
  b.ic += action(r, 'initiate_checkout') || action(r, 'omni_initiated_checkout');
}
export function derive(b) {
  return {
    ...b,
    roas: b.spend ? b.revenue / b.spend : null,
    cpa: b.purchases ? b.spend / b.purchases : null,
    ctr: b.impressions ? (b.clicks / b.impressions) * 100 : null,
    cpc: b.clicks ? b.spend / b.clicks : null,
  };
}

// Budgets come in the currency's minor unit (paise for INR).
export const fromMinor = (v) => (v == null || v === '' ? null : num(v) / 100);
export const toMinor = (rupees) => Math.round(rupees * 100);

export function adsManagerLink(account, level, id) {
  const act = account.replace(/^act_/, '');
  const tab = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${act}&selected_${level}_ids=${id}`;
}
