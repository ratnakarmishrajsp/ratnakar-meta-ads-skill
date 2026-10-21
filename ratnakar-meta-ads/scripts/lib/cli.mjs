// Argument parsing, dates in the business timezone, formatting and output helpers.
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

// ---------- dates (all windows are calendar days in the business timezone) ----------
export function todayIn(tz, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function offsetMinutes(tz, date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
// "2026-01-31" + "00:00" in tz → ISO string with explicit offset, e.g. 2026-01-31T00:00:00+05:30
export function localToIso(ymd, hm, tz) {
  if (hm.length === 5) hm += ':00';
  const guess = new Date(`${ymd}T${hm}Z`);
  const off = offsetMinutes(tz, guess);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${ymd}T${hm}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
export function hoursSince(iso) { return (Date.now() - Date.parse(iso)) / 3600e3; }

// --date today|yesterday|YYYY-MM-DD  |  --since X --until Y  |  --days N (last N days incl. today)
export function resolveWindow(args, tz, fallbackDays = 1) {
  const today = todayIn(tz);
  const word = (v) => (v === 'today' ? today : v === 'yesterday' ? addDays(today, -1) : v);
  let since, until;
  if (args.since || args.until) { since = word(args.since || args.until); until = word(args.until || today); }
  else if (args.days) { until = today; since = addDays(today, -(Math.max(1, +args.days) - 1)); }
  else if (args.date) { since = until = word(args.date); }
  else { until = today; since = addDays(today, -(fallbackDays - 1)); }
  for (const d of [since, until]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Bad date "${d}". Use today, yesterday or YYYY-MM-DD.`);
  if (since > until) throw new Error(`--since ${since} is after --until ${until}`);
  return { since, until, today, isToday: until === today, label: since === until ? since : `${since} → ${until}` };
}

// ---------- formatting ----------
export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const money = (n, cur = 'INR') => (n == null || !Number.isFinite(n)) ? 'n/a'
  : (cur === 'INR' ? '₹' : cur + ' ') + Math.round(n).toLocaleString('en-IN');
export const ratio = (n) => (n == null || !Number.isFinite(n)) ? 'n/a' : n.toFixed(2) + 'x';
export const pct = (n, d = 1) => (n == null || !Number.isFinite(n)) ? 'n/a' : n.toFixed(d) + '%';
export const safeDiv = (a, b) => (b ? a / b : null);
export const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function table(headers, rows) {
  if (!rows.length) return '(none)';
  const esc = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
  return [
    '| ' + headers.join(' | ') + ' |',
    '|' + headers.map(() => '---').join('|') + '|',
    ...rows.map((r) => '| ' + r.map(esc).join(' | ') + ' |'),
  ].join('\n');
}

export function printSources(sources) {
  console.log('\n**Sources used**');
  for (const s of sources) console.log(`- ${s}`);
}
export function printWarnings(warnings) {
  if (!warnings.length) return;
  console.log('\n**⚠️ Data warnings (read before trusting the numbers)**');
  for (const w of warnings) console.log(`- ${w}`);
}

// Run a script's main(); on error print a clear message (never a stack with secrets) and exit 1.
export async function run(main) {
  try { await main(); }
  catch (e) {
    console.error(`\n❌ ERROR: ${redact(e.message)}`);
    if (e.hint) console.error(`   Fix: ${e.hint}`);
    console.error('   Nothing was changed. Numbers above this line (if any) are incomplete.');
    process.exit(1);
  }
}
export function redact(s) {
  return String(s)
    .replace(/access_token=[^&\s"]+/g, 'access_token=<hidden>')
    .replace(/\b(EAA[A-Za-z0-9]{10,}|shp(at|ss|ca)_[A-Za-z0-9]+)\b/g, '<hidden-token>');
}
export function fail(message, hint) { const e = new Error(message); e.hint = hint; throw e; }
