// Business config (costs, rates, thresholds). Never guessed: if a value is missing, scripts say so.
// Search order: --config <file> > META_ADS_CONFIG > ./ratnakar-meta-ads.config.json > <skill>/config.json
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SKILL_DIR } from './env.mjs';
import { fail } from './cli.mjs';

const DEFAULTS = {
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  products: [],
  default_product_cost: null,
  shipping: { forward_per_order: null, rto_return_per_order: null, rto_packaging_loss: 0, use_shiprocket_actuals: true, shiprocket_add_gst_pct: 0 },
  cod_fee: { flat: 0, pct_of_order: 0, charged_on_rto: false },
  payment_gateway_fee_pct: 0,
  rto: { source: 'auto', cod_rate_pct: null, prepaid_rate_pct: null, shopify_rto_tags: ['RTO'], lookback_days: 30, min_closed_shipments: 20 },
  gst: { sales_gst_registered: false, sales_gst_pct: 18, prices_include_gst: true, meta_gst_pct: 18, claim_meta_gst_credit: false },
  orders: {
    duplicate_window_hours: 24,
    exclude_tags: ['test'],
    cod_gateway_regex: 'cod|cash on delivery|cash_on_delivery',
    prepaid_gateway_regex: 'payu|razorpay|cashfree|phonepe|paytm|stripe|ccavenue|easebuzz|juspay|billdesk|snapmint|simpl|gokwik|shopify_payments|shopify payments|upi|card|netbanking|wallet',
  },
  assumptions: { aov: null, cod_share_pct: null },
  report: { burning_cash_spend: null, min_spend_to_judge: null },
  autopilot: {
    min_age_hours_ad: 24,
    min_age_hours_adset: 72,
    stop_loss_spend: null,
    pause_min_spend: null,
    pause_roas_below: null,
    scale_min_purchases: 3,
    scale_roas_at_least: null,
    scale_margin_over_break_even: 1.3,
    max_budget_increase_pct: 20,
    min_hours_between_budget_changes: 72,
    max_daily_budget_per_item: null,
    max_total_daily_budget: null,
    skip_if_learning: true,
    plan_valid_hours: 6,
  },
  campaign_defaults: { country: 'IN', age_min: 18, age_max: 65, name_prefix: 'CLAUDE', url_tags: 'utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}' },
  comments: { own_domains: [], extra_spam_words: [], extra_abuse_words: [], extra_complaint_words: [], lookback_days: 14 },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (k.startsWith('_') && k !== '_example') continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(args = {}, { required = false } = {}) {
  const tries = [args.config, process.env.META_ADS_CONFIG, path.join(process.cwd(), 'ratnakar-meta-ads.config.json'), path.join(SKILL_DIR, 'config.json')].filter(Boolean);
  for (const f of tries) {
    const p = path.resolve(f);
    if (!fs.existsSync(p)) {
      if (f === args.config || f === process.env.META_ADS_CONFIG) fail(`Config file not found: ${p}`);
      continue;
    }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail(`Config ${p} is not valid JSON: ${e.message}`); }
    const cfg = merge(DEFAULTS, raw);
    cfg._file = p;
    if (raw._example) {
      if (required) fail(`Config ${p} still has "_example": true, so its costs are made-up examples.`,
        'Copy config.example.json to config.json, put in YOUR real costs and rates, and delete the "_example" line.');
      cfg._isExample = true;
    }
    return cfg;
  }
  if (required) fail('No config.json found, so product costs, shipping, COD fees and RTO are unknown.',
    `Copy ${path.join(SKILL_DIR, 'config.example.json')} to config.json (same folder), fill your real numbers, delete the "_example" line.`);
  return { ...DEFAULTS, _file: null, _missing: true };
}

export function dataDir() {
  const d = process.env.META_ADS_DATA_DIR || path.join(os.homedir(), '.ratnakar-meta-ads');
  fs.mkdirSync(path.join(d, 'plans'), { recursive: true });
  return d;
}
