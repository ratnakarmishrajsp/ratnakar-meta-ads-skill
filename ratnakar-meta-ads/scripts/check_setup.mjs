// Job 0: is everything connected? Read-only. Prints which of the 7 jobs are ready and what to fix.
// Usage: node scripts/check_setup.mjs [--env <file(s)>] [--config <file>]
import { parseArgs, run, addDays, todayIn, localToIso } from './lib/cli.mjs';
import { loadEnv, readCreds, has } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { metaClient } from './lib/meta.mjs';
import { shopifyClient, fetchOrders } from './lib/shopify.mjs';
import { shiprocketClient, fetchShipments } from './lib/shiprocket.mjs';

const ok = (m) => console.log(`✅ ${m}`);
const bad = (m, fix) => console.log(`❌ ${m}${fix ? `\n   → ${fix}` : ''}`);
const warn = (m) => console.log(`⚠️  ${m}`);

run(async () => {
  const args = parseArgs();
  const env = loadEnv(args.env);
  const creds = readCreds();
  const ready = {};
  console.log('# Setup check (read-only, nothing is changed)\n');

  const major = +process.versions.node.split('.')[0];
  major >= 18 ? ok(`Node.js ${process.versions.node}`) : bad(`Node.js ${process.versions.node} is too old`, 'Install Node.js 18 or newer from nodejs.org');
  env.loaded.length ? ok(`Credentials loaded from ${env.loaded.length} .env file(s)`) : warn('No .env file found; using environment variables only');
  for (const m of env.missing) bad(`Listed env file not found: ${m}`);

  // ---- config ----
  let cfg;
  try {
    cfg = loadConfig(args);
    if (cfg._missing) bad('config.json not found: profit, product P&L and autopilot need it', 'Copy config.example.json to config.json and fill in your real costs');
    else if (cfg._isExample) bad(`Config ${cfg._file} still has "_example": true`, 'Replace the example costs with yours, then delete the "_example" line');
    else {
      ok(`Config: ${cfg._file}`);
      if (!cfg.products.length && cfg.default_product_cost == null) bad('No product costs in config', 'Add products[] with cost, or default_product_cost');
      if (cfg.shipping.forward_per_order == null) warn('shipping.forward_per_order not set (needed unless every order is matched in Shiprocket)');
      if (cfg.rto.cod_rate_pct == null) warn('rto.cod_rate_pct not set (needed when Shiprocket is not connected or has too few closed shipments)');
    }
  } catch (e) { bad(e.message, e.hint); cfg = loadConfig({}); }
  const cfgReal = cfg && !cfg._missing && !cfg._isExample;
  const tz = cfg.timezone;

  // ---- Meta ----
  console.log('\n## Meta (Facebook / Instagram ads)');
  let scopes = [];
  if (!has.meta(creds)) bad('META_ACCESS_TOKEN or META_AD_ACCOUNT_ID missing', 'SETUP.md step 2');
  else {
    try {
      const meta = metaClient(creds);
      const dbg = await meta.get('debug_token', { input_token: creds.meta.token });
      const d = dbg.data || {};
      scopes = d.scopes || [];
      d.is_valid ? ok(`Token valid (type ${d.type}, ${d.expires_at ? 'expires ' + new Date(d.expires_at * 1000).toISOString().slice(0, 10) : 'never expires'})`) : bad('Token is NOT valid', 'Generate a new System User token');
      const acc = await meta.get(meta.account, { fields: 'name,currency,timezone_name,account_status,spend_cap,amount_spent' });
      ok(`Ad account "${acc.name}" | ${acc.currency} | ${acc.timezone_name} | status ${acc.account_status === 1 ? 'ACTIVE' : acc.account_status}`);
      if (acc.timezone_name !== tz) warn(`Ad account timezone ${acc.timezone_name} differs from config timezone ${tz}`);
      if (+acc.spend_cap > 0) ok(`Spend cap headroom ${acc.currency} ${Math.round((acc.spend_cap - acc.amount_spent) / 100).toLocaleString('en-IN')}`);
      const need = (s) => scopes.includes(s);
      ready.report = need('ads_read') || need('ads_management');
      ready.write = need('ads_management');
      ready.report ? ok('ads_read / ads_management: reports work') : bad('Missing ads_read', 'Add ads_read and ads_management to the token');
      ready.write ? ok('ads_management: campaign creation and pause/scale work') : bad('Missing ads_management (jobs 1 and 5 cannot write)');
      if (creds.meta.pixelId) {
        try { const px = await meta.get(creds.meta.pixelId, { fields: 'name,last_fired_time' }); ok(`Pixel "${px.name}" last fired ${px.last_fired_time || 'never'}`); }
        catch (e) { bad(`Pixel ${creds.meta.pixelId} not readable: ${e.message}`, 'Assign the pixel (dataset) to the system user'); ready.write = false; }
      } else { bad('META_PIXEL_ID missing', 'Needed to create sales campaigns (job 1)'); }
      // Comments
      const fbRead = need('pages_read_user_content') && need('pages_read_engagement');
      const fbHide = need('pages_manage_engagement');
      const igOk = need('instagram_basic') && need('instagram_manage_comments');
      if (creds.meta.pageId) {
        try { await meta.pageToken(creds.meta.pageId); ok('Page token available'); } catch (e) { bad(e.message, e.hint); }
      } else warn('META_PAGE_ID missing (needed for new ad creatives and Facebook comments)');
      fbRead ? ok('Facebook comments: can read') : bad('Facebook comments: cannot read', 'Add pages_read_engagement + pages_read_user_content');
      fbHide ? ok('Facebook comments: can hide') : warn('Facebook comments: cannot hide (add pages_manage_engagement)');
      igOk ? ok('Instagram comments: can read and hide') : warn('Instagram comments: add instagram_basic + instagram_manage_comments');
      ready.comments = fbRead || igOk;
    } catch (e) { bad(e.message, e.hint); }
  }

  // ---- Shopify ----
  console.log('\n## Shopify');
  if (!has.shopify(creds)) bad('Shopify credentials missing', 'SETUP.md step 3');
  else {
    try {
      const shop = await shopifyClient(creds);
      ok(`Logged in to ${shop.domain} (API ${shop.version})`);
      if (shop.scopes) {
        const writes = shop.scopes.filter((s) => s.startsWith('write_'));
        shop.scopes.includes('read_orders') || shop.scopes.includes('write_orders') ? ok('read_orders scope present') : bad('read_orders scope missing', 'Add read_orders to the app version and release it');
        if (!shop.scopes.includes('read_all_orders')) warn('No read_all_orders: only the last 60 days of orders are visible');
        if (writes.length) warn(`App has ${writes.length} write scopes (${writes.slice(0, 4).join(', ')}…). This skill needs none; remove them for safety.`);
      }
      const w = [];
      const t = todayIn(tz);
      const r = await fetchOrders(shop, localToIso(addDays(t, -6), '00:00:00', tz), localToIso(t, '23:59:59', tz), w);
      ok(`Read ${r.orders.length} orders from the last 7 days (served by API ${r.apiVersion})`);
      const shopInfo = (await shop.gql('{ shop { ianaTimezone currencyCode } }')).data?.shop;
      if (shopInfo) console.log(`   Store timezone ${shopInfo.ianaTimezone}, currency ${shopInfo.currencyCode} (the skill always queries in ${tz})`);
      for (const x of w) warn(x);
      const noPhone = r.orders.filter((o) => !o.phoneKey).length;
      if (r.orders.length && noPhone === r.orders.length) warn('No phone numbers returned: duplicate-order check will not work (protected customer data)');
      ready.shopify = true;
    } catch (e) { bad(e.message, e.hint); }
  }

  // ---- Shiprocket ----
  console.log('\n## Shiprocket (optional)');
  if (!has.shiprocket(creds)) warn('Not connected: RTO rate and shipping cost will come from config.json');
  else {
    try {
      const sr = await shiprocketClient(creds);
      const t = todayIn(tz);
      const s = await fetchShipments(sr, addDays(t, -6), t, 3);
      ok(`Logged in; ${s.length} shipments in the last 7 days (first pages)`);
      ready.shiprocket = true;
    } catch (e) { bad(e.message, e.hint); }
  }

  // ---- summary ----
  const y = (b) => (b ? '✅ ready' : '❌ not ready');
  console.log('\n## Jobs');
  console.log(`1. Campaign in one line ........ ${y(ready.write && creds.meta.pixelId && creds.meta.pageId)}`);
  console.log(`2. Daily report ................ ${y(ready.report)}`);
  console.log(`3. Real profit ................. ${y(ready.report && ready.shopify && cfgReal)}`);
  console.log(`4. Profit by product ........... ${y(ready.report && ready.shopify && cfgReal)}`);
  console.log(`5. Fix my ads (pause / scale) .. ${y(ready.write && cfgReal)}`);
  console.log(`6. Comment guard ............... ${y(ready.comments)}`);
  console.log(`7. Orders + RTO ................ ${y(ready.shopify)}${ready.shiprocket ? ' (RTO from Shiprocket)' : ' (RTO from Shopify tags / config)'}`);
});
