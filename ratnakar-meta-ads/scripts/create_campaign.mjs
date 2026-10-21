// Job 1: "kal ke liye 500 ka sales campaign bana do". Creates campaign + ad set (+ ad if a creative is given),
// ALWAYS PAUSED. Default = dry run (summary only). Activation is a separate, explicit step.
//
// Dry run:   node scripts/create_campaign.mjs --budget 500 --start tomorrow [--url https://store/products/x]
//              [--creative-id ID | --post-id PAGEID_POSTID | --video-id ID | --image-hash HASH]
//              [--message "primary text"] [--headline "..."] [--name "..."] [--country IN] [--age-min 18] [--age-max 65]
//            add --validate to let Meta check the campaign payload without creating anything
// Create:    same command + --execute            → everything is created PAUSED, nothing spends
// Activate:  node scripts/create_campaign.mjs --activate <campaign_id>            (dry run: shows what turns on)
//            node scripts/create_campaign.mjs --activate <campaign_id> --execute  (only after the user said yes)
import { parseArgs, run, todayIn, addDays, localToIso, money, table, fail } from './lib/cli.mjs';
import { loadEnv, readCreds } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { metaClient, toMinor, fromMinor, adsManagerLink } from './lib/meta.mjs';
import { logChange, readChanges } from './lib/log.mjs';

run(async () => {
  const args = parseArgs();
  loadEnv(args.env);
  const creds = readCreds();
  const cfg = loadConfig(args);
  const meta = metaClient(creds);
  if (args.activate) return activate(meta, args, cfg);

  const tz = cfg.timezone, cur = cfg.currency, def = cfg.campaign_defaults;
  const budget = +args.budget;
  if (!budget || budget <= 0) fail('Missing --budget (daily budget in your currency, e.g. --budget 500).');
  if (!creds.meta.pixelId) fail('META_PIXEL_ID is missing; a sales campaign needs your pixel/dataset ID.', 'Events Manager → your dataset → copy the ID into .env');

  // ---- start / end time ----
  const today = todayIn(tz);
  const toTime = (v) => {
    if (!v || v === 'now') return null;
    if (v === 'today') return null;
    if (v === 'tomorrow') return localToIso(addDays(today, 1), '00:00', tz);
    const m = String(v).match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/);
    if (!m) fail(`Bad --start/--end "${v}". Use tomorrow, YYYY-MM-DD or YYYY-MM-DDTHH:MM.`);
    return localToIso(m[1], m[2] || '00:00', tz);
  };
  const start = toTime(args.start), end = toTime(args.end);
  const startLabel = start ? start.replace('T', ' ').slice(0, 16) + ` (${tz})` : 'as soon as it is activated';

  // ---- read-only pre-checks ----
  const checks = [];
  const pixel = await meta.get(creds.meta.pixelId, { fields: 'name,last_fired_time' }).catch((e) => ({ error: e.message }));
  checks.push(pixel.error ? `❌ Pixel ${creds.meta.pixelId}: ${pixel.error}` : `✅ Pixel "${pixel.name}" (last fired ${pixel.last_fired_time || 'never'})`);
  let creativeLine = 'none (campaign + ad set only; add an ad later)';
  let link = args.url || null;
  let existingCreative = null;
  if (args['creative-id']) {
    existingCreative = await meta.get(args['creative-id'], { fields: 'name,object_story_spec,asset_feed_spec{link_urls},effective_object_story_id' });
    link ||= existingCreative.object_story_spec?.link_data?.link || existingCreative.object_story_spec?.video_data?.call_to_action?.value?.link || existingCreative.asset_feed_spec?.link_urls?.[0]?.website_url || null;
    creativeLine = `reuse existing creative ${args['creative-id']} "${existingCreative.name || ''}" (keeps its post, likes and comments)`;
  } else if (args['post-id']) {
    creativeLine = `existing Page post ${args['post-id']} as the ad (keeps its likes and comments)`;
  } else if (args['video-id'] || args['image-hash']) {
    if (!creds.meta.pageId) fail('META_PAGE_ID is missing; a new creative is published from your Page.');
    if (!args.url) fail('A new creative needs --url (the exact product page the video/image talks about).');
    if (!args.message) fail('A new creative needs --message (primary text).');
    creativeLine = `new ${args['video-id'] ? 'video ' + args['video-id'] : 'image ' + args['image-hash']} creative from Page ${creds.meta.pageId}`;
  }
  if (link) {
    try {
      const r = await fetch(link, { redirect: 'follow' });
      checks.push(r.ok ? `✅ Landing page answers HTTP ${r.status}: ${link}` : `❌ Landing page answers HTTP ${r.status}: ${link} (do NOT activate until this is fixed)`);
    } catch (e) { checks.push(`❌ Landing page unreachable: ${link} (${e.message})`); }
  }

  const name = args.name || `${def.name_prefix} | Sales | ${money(budget, cur)}/day | ${start ? start.slice(0, 10) : today}`;
  const campaign = {
    name, objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION',
    daily_budget: toMinor(budget), bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  };
  const country = (args.country || def.country || 'IN').toUpperCase();
  const ageMin = +(args['age-min'] || def.age_min || 18), ageMax = +(args['age-max'] || def.age_max || 65);
  const adset = {
    name: `${country} ${ageMin}-${ageMax} | Advantage+ audience & placements`, status: 'PAUSED',
    optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS',
    promoted_object: { pixel_id: creds.meta.pixelId, custom_event_type: 'PURCHASE' },
    targeting: { geo_locations: { countries: [country] }, age_min: ageMin, age_max: ageMax, targeting_automation: { advantage_audience: 1 } },
    ...(start ? { start_time: start } : {}), ...(end ? { end_time: end } : {}),
  };

  console.log('# New sales campaign: summary (nothing created yet)\n');
  console.log(table(['Setting', 'Value'], [
    ['Campaign name', name],
    ['Objective', 'Sales (OUTCOME_SALES), optimise for Purchase on your pixel'],
    ['Daily budget', `${money(budget, cur)}/day at campaign level (CBO); ≈ ${money(budget * 30, cur)} per 30 days + GST`],
    ['Bid strategy', 'Highest volume (lowest cost, no cap)'],
    ['Starts', startLabel],
    ['Audience', `${country}, age ${ageMin}-${ageMax}, all genders, Advantage+ audience ON (no interests)`],
    ['Placements', 'Advantage+ placements (Meta chooses: Feeds, Reels, Stories, WhatsApp Status…)'],
    ['Ad', creativeLine],
    ...(args.message ? [['Primary text', args.message]] : []),
    ...(args.headline ? [['Headline', args.headline]] : []),
    ...(link ? [['Landing page', link]] : []),
    ['Status after creation', 'PAUSED (spends nothing until you activate it)'],
  ]));
  console.log('\n' + checks.join('\n'));
  console.log('\nBefore you say yes, check: does the video/image talk about EXACTLY the product on the landing page, and do the text and headline say the same thing?');

  if (args.validate && !args.execute) {
    await meta.validateOnly(`${meta.account}/campaigns`, campaign);
    console.log('\n✅ Meta validated the campaign payload (validate_only: nothing was created). The ad set is validated on creation.');
  }
  if (!args.execute) {
    console.log('\nDRY RUN: nothing was created. To create it PAUSED, run the same command with --execute after the user says yes.');
    return;
  }

  // ---- create, all PAUSED ----
  meta.unlockWrites();
  const created = [];
  try {
    const c = await meta.post(`${meta.account}/campaigns`, campaign);
    created.push(['campaign', c.id]);
    const s = await meta.post(`${meta.account}/adsets`, { ...adset, campaign_id: c.id });
    created.push(['adset', s.id]);
    let creativeId = args['creative-id'] || null;
    if (!creativeId && args['post-id']) creativeId = (await meta.post(`${meta.account}/adcreatives`, { name: `${name} | post`, object_story_id: args['post-id'] })).id;
    if (!creativeId && (args['video-id'] || args['image-hash'])) {
      const cta = { type: args.cta || 'SHOP_NOW', value: { link: args.url } };
      let spec;
      if (args['video-id']) {
        const v = await meta.get(args['video-id'], { fields: 'thumbnails{uri,is_preferred}' });
        const thumb = (v.thumbnails?.data || []).find((t) => t.is_preferred) || v.thumbnails?.data?.[0];
        spec = { page_id: creds.meta.pageId, video_data: { video_id: args['video-id'], message: args.message, title: args.headline, link_description: args.description, call_to_action: cta, ...(thumb ? { image_url: thumb.uri } : {}) } };
      } else {
        spec = { page_id: creds.meta.pageId, link_data: { image_hash: args['image-hash'], link: args.url, message: args.message, name: args.headline, description: args.description, call_to_action: cta } };
      }
      if (creds.meta.igUserId) spec.instagram_user_id = creds.meta.igUserId;
      creativeId = (await meta.post(`${meta.account}/adcreatives`, { name: `${name} | creative`, object_story_spec: spec, url_tags: def.url_tags })).id;
      created.push(['creative', creativeId]);
    }
    if (creativeId) {
      const a = await meta.post(`${meta.account}/ads`, { name: args['ad-name'] || `${name} | ad 1`, adset_id: s.id, status: 'PAUSED', creative: { creative_id: creativeId } });
      created.push(['ad', a.id]);
    }
  } catch (e) {
    logChange({ job: 'create_campaign', action: 'create_failed', created, error: e.message });
    console.log(`\n❌ Stopped: ${e.message}`);
    if (created.length) console.log(`Already created (all PAUSED, spending nothing): ${created.map(([t, id]) => `${t} ${id}`).join(', ')}. Fix the error and add the rest, or delete these in Ads Manager.`);
    process.exit(1);
  }
  const cid = created[0][1];
  logChange({ job: 'create_campaign', action: 'create', campaign_id: cid, created, budget, start, note: args.note || null });
  const back = await meta.get(cid, { fields: 'name,status,effective_status,daily_budget' });
  console.log(`\n✅ Created PAUSED: ${back.name} | ${back.status} | ${money(fromMinor(back.daily_budget), cur)}/day`);
  console.log(table(['Type', 'ID'], created));
  console.log(`\nAds Manager: ${adsManagerLink(meta.account, 'campaign', cid)}`);
  console.log(`\nNothing is spending. When the user says yes, activate with:\nnode scripts/create_campaign.mjs --activate ${cid} --execute`);
});

async function activate(meta, args, cfg) {
  const cid = String(args.activate);
  const cur = cfg.currency;
  const c = await meta.get(cid, { fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,objective' });
  const adsets = await meta.getAll(`${cid}/adsets`, { fields: 'id,name,status,effective_status,start_time,daily_budget' });
  const ads = await meta.getAll(`${cid}/ads`, { fields: 'id,name,status,effective_status,adset_id' });
  const ours = new Set(readChanges(24 * 365).filter((e) => e.job === 'create_campaign' && e.campaign_id === cid).flatMap((e) => (e.created || []).map(([, id]) => id)));
  const flip = [c, ...adsets, ...ads].filter((o) => o.status === 'PAUSED' && (o.id === cid || ours.has(o.id)));
  const leftPaused = [...adsets, ...ads].filter((o) => o.status === 'PAUSED' && !ours.has(o.id));
  console.log(`# Activate "${c.name}" (${cid})\n`);
  console.log(table(['What', 'Name', 'Now', 'After'], flip.map((o) => [o.id === cid ? 'campaign' : adsets.includes(o) ? 'ad set' : 'ad', o.name, o.status, 'ACTIVE'])));
  const b = fromMinor(c.daily_budget);
  console.log(`\nBudget: ${b ? money(b, cur) + '/day' : 'see ad sets'} | start: ${adsets.map((s) => s.start_time || 'now').join(', ')}`);
  if (leftPaused.length) console.log(`\nStays PAUSED (not created by this skill, turn on yourself if wanted): ${leftPaused.map((o) => `${o.name} (${o.id})`).join(', ')}`);
  if (!flip.length) { console.log('\nNothing to activate: everything is already on.'); return; }
  if (!args.execute) { console.log('\nDRY RUN: nothing changed. This starts spending money. Run with --execute only after the user clearly says yes.'); return; }
  meta.unlockWrites();
  for (const o of [...flip].reverse()) await meta.post(o.id, { status: 'ACTIVE' }); // ads first, campaign last
  const after = await meta.get(cid, { fields: 'status,effective_status' });
  logChange({ job: 'create_campaign', action: 'activate', campaign_id: cid, ids: flip.map((o) => o.id), note: args.note || null });
  console.log(`\n✅ Activated. Campaign status ${after.status}, delivery ${after.effective_status} (IN_PROCESS = Meta is reviewing the ads; normal for up to a few hours).`);
}
