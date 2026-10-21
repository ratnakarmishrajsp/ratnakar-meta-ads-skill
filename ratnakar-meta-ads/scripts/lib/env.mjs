// Loads credentials without ever printing them.
// Order (first value wins): real environment variables > files listed in META_ADS_ENV_FILES
// (or --env, separated like PATH: ";" on Windows, ":" elsewhere) > <skill folder>/.env > ./.env
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function loadEnv(list = process.env.META_ADS_ENV_FILES) {
  const explicit = (list || '').split(path.delimiter).map((s) => s.trim()).filter(Boolean);
  const candidates = [...explicit, path.join(SKILL_DIR, '.env'), path.join(process.cwd(), '.env')];
  const loaded = [];
  const missing = [];
  for (const f of [...new Set(candidates.map((c) => path.resolve(c)))]) {
    if (!fs.existsSync(f)) {
      if (explicit.some((e) => path.resolve(e) === f)) missing.push(f);
      continue;
    }
    for (const [k, v] of Object.entries(parseEnvFile(f))) if (process.env[k] === undefined && v !== '') process.env[k] = v;
    loaded.push(f);
  }
  return { loaded, missing };
}

// Names used by the skill, with aliases so existing setups keep working.
export function readCreds() {
  const e = process.env;
  const shop = (e.SHOPIFY_STORE_DOMAIN || e.SHOPIFY_STORE_URL || e.SHOPIFY_SHOP || '')
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return {
    meta: {
      token: e.META_ACCESS_TOKEN || '',
      account: e.META_AD_ACCOUNT_ID ? 'act_' + e.META_AD_ACCOUNT_ID.replace(/^act_/, '') : '',
      pageId: e.META_PAGE_ID || '',
      pixelId: e.META_PIXEL_ID || '',
      igUserId: e.META_INSTAGRAM_ACCOUNT_ID || '',
      version: e.META_API_VERSION || 'v26.0',
    },
    shopify: {
      domain: shop && !shop.includes('.') ? `${shop}.myshopify.com` : shop,
      clientId: e.SHOPIFY_CLIENT_ID || '',
      clientSecret: e.SHOPIFY_CLIENT_SECRET || '',
      accessToken: e.SHOPIFY_ACCESS_TOKEN || e.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
      version: e.SHOPIFY_API_VERSION_OVERRIDE || '2026-10',
    },
    shiprocket: {
      email: e.SHIPROCKET_EMAIL || '',
      password: e.SHIPROCKET_PASSWORD || '',
    },
  };
}

export const has = {
  meta: (c) => !!(c.meta.token && c.meta.account),
  shopify: (c) => !!(c.shopify.domain && (c.shopify.accessToken || (c.shopify.clientId && c.shopify.clientSecret))),
  shiprocket: (c) => !!(c.shiprocket.email && c.shiprocket.password),
};
