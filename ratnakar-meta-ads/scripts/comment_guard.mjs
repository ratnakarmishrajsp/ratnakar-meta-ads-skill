// Job 6: "Clean my ad comments". Lists comments on your ads (Facebook + Instagram), proposes HIDING spam,
// abuse and scam links, and FLAGS genuine complaints for you to answer. It never deletes anything
// (there is no delete call in this skill). Default = DRY RUN: list + numbered plan.
//
// List:     node scripts/comment_guard.mjs [--days 14]
// Hide:     node scripts/comment_guard.mjs --execute --plan <plan file> --approve 1,2,5 --note "user: haan hide karo"
import { parseArgs, run, todayIn, addDays, cut, table, printSources, printWarnings, fail } from './lib/cli.mjs';
import { loadEnv, readCreds } from './lib/env.mjs';
import { loadConfig } from './lib/config.mjs';
import { metaClient } from './lib/meta.mjs';
import { savePlan, loadPlan, approvedActions, logChange } from './lib/log.mjs';

const SPAM = /work from home|part[ -]?time job|earn (money|daily|₹|rs)|daily (income|earning)|crypto|bitcoin|forex|trading (tips|signal)|investment plan|loan (approved|available)|betting|casino|satta|follow (me|my page|back)|check (out )?my (profile|bio|page|reel)|dm (me|for)|inbox me|giveaway|free followers|promote your (page|business)|link in (my )?bio|whatsapp (me|now) for/i;
// Short forms like "mc"/"bc" are left out on purpose ("bc" also means "because"); add your own via config.
const ABUSE = /\b(fuck\w*|f\*+k|bitch\w*|bastard|asshole|motherfucker|madarchod|maderchod|bhenchod|behenchod|bhen ?ke ?lode|chutiy\w*|gandu|harami|haramkhor|kamin[ae]|randi|bhosd\w*|lavd\w*|lund|gaand|bsdk)\b/i;
const COMPLAINT = /(order|parcel|product|saman|samaan)\s*(abhi tak\s*)?(nahi|nhi|nai|not|never)\s*(aaya|aya|mila|received|delivered|pahuncha)|not (yet )?(received|delivered)|never (received|came)|delivery (late|nahi|nhi|delay)|refund|paisa wapas|paise wapas|money back|\breturn\b|replace|wrong (product|item|size)|galat (product|saman|maal)|damaged|broken|tuta|leak|fake product|duplicate (product|maal)|nakli|fraud|scam|cheat|dhokha|dhoka|thag|worst|bekar|bekaar|bakwas|bakwaas|waste of money|paisa barbad|poor quality|quality (kharab|bekar|bad)|kharab|no response|customer care|complain|chor|loot|lut liya|disappoint|faltu/i;
const QUESTION = /\?|kitne ka|kitna (hai|price)|price|rate kya|cod (available|hai)|how (to|can i) order|kaise (order|milega|mangaye)|kab tak|delivery (time|kitne din)|original hai|size kya/i;
const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|in|net|org|xyz|top|shop|store|site|online|link|info|io|me|ly)\b(\/\S*)?|\b(wa\.me|t\.me|bit\.ly|tinyurl)\/?\S*/gi;
const PHONE = /(\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/;

function classify(text, own, extra) {
  const t = text || '';
  const links = (t.match(LINK) || []).filter((l) => !own.some((d) => l.toLowerCase().includes(d)));
  const has = (re, words) => re.test(t) || words.some((w) => t.toLowerCase().includes(w.toLowerCase()));
  const complaint = has(COMPLAINT, extra.complaint);
  const abuse = has(ABUSE, extra.abuse);
  const spam = has(SPAM, extra.spam);
  const phone = PHONE.test(t);
  if (complaint) return { cat: 'COMPLAINT', act: 'FLAG', why: [abuse && 'angry, with abuse', links.length && 'contains a link', phone && 'contains a phone number (hide after you reply, for their privacy)'].filter(Boolean).join('; ') || 'customer problem: reply, do not hide' };
  if (links.length) return { cat: 'SCAM/SPAM LINK', act: 'HIDE', why: `link to ${cut(links[0], 40)}` };
  if (abuse) return { cat: 'ABUSE', act: 'HIDE', why: 'abusive words' };
  if (spam) return { cat: 'SPAM', act: 'HIDE', why: 'promotion / spam pattern' };
  if (phone) return { cat: 'PHONE NUMBER', act: 'FLAG', why: 'someone posted a phone number: check whether it is a customer (privacy) or a spammer' };
  if (QUESTION.test(t)) return { cat: 'QUESTION', act: 'REPLY', why: 'buyer question: answering it helps sales' };
  return { cat: 'OK', act: 'KEEP', why: '' };
}

run(async () => {
  const args = parseArgs();
  loadEnv(args.env);
  const creds = readCreds();
  const cfg = loadConfig(args);
  const meta = metaClient(creds);
  if (args.execute) return execute(meta, cfg, args);

  const cc = cfg.comments, tz = cfg.timezone;
  const days = +(args.days || cc.lookback_days || 14);
  const since = addDays(todayIn(tz), -(days - 1));
  const sinceMs = Date.parse(since + 'T00:00:00Z') - 14 * 3600e3;
  const sources = [], warnings = [];
  const own = (cc.own_domains || []).map((d) => d.toLowerCase());
  if (!own.length) warnings.push('comments.own_domains is empty in config, so links to YOUR store would also count as foreign links.');
  const extra = { spam: cc.extra_spam_words || [], abuse: cc.extra_abuse_words || [], complaint: cc.extra_complaint_words || [] };

  // Ads that were live in the window → their Facebook post and Instagram media.
  const spent = await meta.getAll(`${meta.account}/insights`, { level: 'ad', fields: 'ad_id,ad_name,spend', time_range: { since, until: todayIn(tz) }, limit: 500 });
  const ids = [...new Set(spent.filter((r) => +r.spend > 0).map((r) => r.ad_id))];
  const active = await meta.getAll(`${meta.account}/ads`, { fields: 'id', filtering: [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }] });
  for (const a of active) if (!ids.includes(a.id)) ids.push(a.id);
  const targets = new Map();
  for (const ad of await meta.byIds('ads', ids, 'id,name,creative{effective_object_story_id,effective_instagram_media_id}')) {
    const fb = ad.creative?.effective_object_story_id, ig = ad.creative?.effective_instagram_media_id;
    if (fb && !targets.has('fb:' + fb)) targets.set('fb:' + fb, { kind: 'FB', id: fb, ad: ad.name });
    if (ig && !targets.has('ig:' + ig)) targets.set('ig:' + ig, { kind: 'IG', id: ig, ad: ad.name });
  }
  sources.push(`Meta Marketing API ${meta.version}: ${ids.length} ads live in ${since} → today; ${targets.size} unique posts (one post can serve many ads)`);

  const pageTokens = new Map();
  const rows = [];
  let hiddenAlready = 0, fbErr = null, igErr = null;
  for (const t of targets.values()) {
    try {
      if (t.kind === 'FB') {
        const pageId = t.id.split('_')[0];
        if (!pageTokens.has(pageId)) pageTokens.set(pageId, await meta.pageToken(pageId));
        const tok = pageTokens.get(pageId);
        let j = await meta.get(`${t.id}/comments`, { fields: 'id,message,created_time,is_hidden,can_hide,from{id,name}', filter: 'stream', order: 'reverse_chronological', limit: 100 }, tok);
        for (let p = 0; p < 10; p++) {
          let old = false;
          for (const c of j.data || []) {
            if (Date.parse(c.created_time) < sinceMs) { old = true; continue; }
            if (c.from?.id === pageId) continue;
            if (c.is_hidden) { hiddenAlready++; continue; }
            rows.push({ kind: 'FB', id: c.id, post: t.id, pageId, ad: t.ad, who: c.from?.name || '(name hidden)', at: c.created_time, text: c.message || '', canHide: c.can_hide !== false });
          }
          if (old || !j.paging?.next) break;
          j = await meta.get(j.paging.next, {}, tok);
        }
      } else {
        const media = await meta.get(t.id, { fields: 'username' });
        let j = await meta.get(`${t.id}/comments`, { fields: 'id,text,timestamp,hidden,username,like_count', limit: 100 });
        for (let p = 0; p < 10; p++) {
          for (const c of j.data || []) {
            if (Date.parse(c.timestamp) < sinceMs || c.username === media.username) continue;
            if (c.hidden) { hiddenAlready++; continue; }
            rows.push({ kind: 'IG', id: c.id, post: t.id, ad: t.ad, who: '@' + (c.username || '?'), at: c.timestamp, text: c.text || '', canHide: true });
          }
          if (!j.paging?.next) break;
          j = await meta.get(j.paging.next);
        }
      }
    } catch (e) { if (t.kind === 'FB') fbErr ??= e.message; else igErr ??= e.message; }
  }
  if (fbErr) warnings.push(`Facebook comments could not be read: ${fbErr}. Needs a Page token with pages_read_engagement + pages_read_user_content (and pages_manage_engagement to hide).`);
  if (igErr) warnings.push(`Instagram comments could not be read: ${igErr}. Needs instagram_basic + instagram_manage_comments + pages_read_engagement.`);
  sources.push(`Facebook Page post comments (Page token) and Instagram media comments, created since ${since}`);

  for (const r of rows) Object.assign(r, classify(r.text, own, extra));
  rows.sort((a, b) => b.at.localeCompare(a.at));
  const hide = rows.filter((r) => r.act === 'HIDE');
  const actions = hide.map((r, i) => ({ n: i + 1, type: 'hide', kind: r.kind, id: r.id, pageId: r.pageId, ad: r.ad, who: r.who, text: r.text, cat: r.cat, why: r.why, canHide: r.canHide }));
  const file = savePlan('comment_guard', actions, { account: meta.account, since });

  console.log(`# Ad comments since ${since}: ${rows.length} visible comments (${hiddenAlready} already hidden)\n`);
  const show = (list) => table(['#', 'Where', 'Who', 'Comment', 'Type', 'Why'], list.map((r, i) => [r.n ?? i + 1, r.kind, cut(r.who, 20), cut(r.text, 80), r.cat, r.why]));
  console.log(`## 🙈 Proposed to HIDE (${actions.length}): spam, abuse, scam links. Hidden = invisible to the public, still visible to the commenter and their friends, reversible.`);
  console.log(show(actions));
  const flags = rows.filter((r) => r.act === 'FLAG');
  console.log(`\n## 🚩 FLAGGED for you (${flags.length}): genuine complaints etc. Not hidden. Reply publicly or move to DM; you decide.`);
  console.log(show(flags));
  const qs = rows.filter((r) => r.act === 'REPLY');
  console.log(`\n## 💬 Questions to answer (${qs.length})`);
  console.log(show(qs));
  console.log(`\nOK comments: ${rows.filter((r) => r.act === 'KEEP').length}`);
  console.log(`\nPlan saved: ${file}`);
  if (actions.length) console.log('Show this list to the user, ask which numbers to hide, then:\nnode scripts/comment_guard.mjs --execute --plan "<plan file>" --approve <numbers> --note "<user\'s exact words>"');
  printWarnings(warnings);
  printSources(sources);
});

async function execute(meta, cfg, args) {
  const plan = loadPlan(args.plan, 'comment_guard', 48);
  if (plan.account !== meta.account) fail('This plan was made for a different ad account.');
  const todo = approvedActions(plan, args.approve);
  meta.unlockWrites();
  const pageTokens = new Map();
  console.log(`# Hiding ${todo.length} approved comment(s). Nothing is deleted.\n`);
  for (const a of todo) {
    try {
      if (a.kind === 'FB') {
        if (!pageTokens.has(a.pageId)) pageTokens.set(a.pageId, await meta.pageToken(a.pageId));
        const tok = pageTokens.get(a.pageId);
        const now = await meta.get(a.id, { fields: 'is_hidden,message' }, tok);
        if (now.is_hidden) { console.log(`⏭️  #${a.n} already hidden.`); continue; }
        await meta.post(a.id, { is_hidden: true }, tok);
      } else {
        const now = await meta.get(a.id, { fields: 'hidden,text' });
        if (now.hidden) { console.log(`⏭️  #${a.n} already hidden.`); continue; }
        await meta.post(a.id, { hide: true });
      }
      logChange({ job: 'comment_guard', action: 'hide', kind: a.kind, id: a.id, ad: a.ad, cat: a.cat, text: cut(a.text, 120), note: args.note || null });
      console.log(`✅ #${a.n} hidden (${a.kind}): "${cut(a.text, 60)}"`);
    } catch (e) { console.log(`❌ #${a.n} not hidden: ${e.message}`); }
  }
  console.log('\nTo unhide: Facebook → the post → comment → Unhide; Instagram → the post → comment → Unhide.');
}
