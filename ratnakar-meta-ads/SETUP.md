# SETUP: Meta Ads Autopilot by Ratnakar Content

> This skill connects your Meta Ads, Shopify and Shiprocket to Claude through their APIs. After that, just talk to Claude:
> "Send me today's report" or "Create a ₹500 sales campaign for tomorrow". Claude runs the scripts and brings back real data.
> Anything that spends money or changes something happens **only after you say "yes"**.

Total time: about 30–45 minutes (first time only). Steps:

| Step | What | Required? |
|---|---|---|
| 1 | Install Claude Code + Node.js, put the skill folder in place | Yes |
| 2 | Meta token (System User) | Yes |
| 3 | Shopify app (Client ID + Secret) | Yes, for profit / orders |
| 4 | Shiprocket API user | Optional (real shipping cost + RTO) |
| 5 | Fill in `.env` and `config.json` | Yes |
| 6 | First test | Yes |

---

## Step 1: Claude Code, Node.js and the skill

**1a. Node.js** (the scripts run on it): install the **LTS** version from https://nodejs.org (18 or newer).
Check: open a terminal and type `node --version`. You should see `v18…` or a higher number.

**1b. Claude Code** (needs a Pro / Max / Team plan; the free plan doesn't include Claude Code):

- Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
- Mac / Linux: `curl -fsSL https://claude.ai/install.sh | bash`
- Or download the Claude Desktop app and use its "Code" tab.

Open a new terminal and type `claude --version`. If a version number shows up, the install worked. Run `claude` once and log in in the browser.
On Windows, also install [Git for Windows](https://git-scm.com/downloads/win) (recommended).

**1c. Put the skill in place:** unzip the zip. Inside is a folder called `ratnakar-meta-ads`. Put it here:

- Windows: `C:\Users\<your-name>\.claude\skills\ratnakar-meta-ads\`
- Mac / Linux: `~/.claude/skills/ratnakar-meta-ads/`

You should see `SKILL.md` directly inside that folder (not another folder inside it). Restart Claude Code.

---

## Step 2: Meta token (System User). The most important step

A System User token **doesn't expire** and only works on the assets you give it. Use this instead of a personal token.

**2a. Create a Meta app** (once):
1. Go to https://developers.facebook.com/apps → **Create App**.
2. Use case: **Other** → app type **Business** → give it a name (e.g. "My Ads Autopilot") → select your Business Portfolio.
3. In the app dashboard, add the **Marketing API** product.

**2b. Create a System User:**
1. Open https://business.facebook.com/settings → **Users → System users → Add**.
2. Give it a name (e.g. "claude-ads") and choose the **Admin** role.
3. Click **Assign assets** and give it these three:
   - **Ad account**: Full control (or at least "Manage campaigns")
   - **Facebook Page**: Full control (hiding comments needs the "Moderate" access on the Page)
   - **Pixel / Dataset** (the one in Events Manager): Full control
4. In Business settings → **Apps**, assign your app to this system user as well.

**2c. Generate the token:**
1. Click the system user → **Generate new token** → choose your app.
2. Expiry: **Never**.
3. Tick these permissions:

| Permission | Used for |
|---|---|
| `ads_management` | creating campaigns, pausing, budgets (jobs 1, 5) |
| `ads_read` | reports (jobs 2, 3, 4) |
| `business_management` | reading the business's assets |
| `pages_show_list` | getting the Page token |
| `pages_read_engagement` | reading Page posts |
| `pages_read_user_content` | reading Facebook ad comments (job 6) |
| `pages_manage_engagement` | hiding Facebook comments (job 6) |
| `pages_manage_ads` | running ads from the Page |
| `instagram_basic` | Instagram account / media |
| `instagram_manage_comments` | reading and hiding Instagram comments (job 6) |

4. **Generate token** → the token is **shown only once**. Copy it straight into `.env` (step 5). Never send it to anyone.

> For your own business's assets you usually don't need App Review. If a permission gives a
> "requires advanced access" error, see `references/troubleshooting.md`.

**2d. Find your IDs:**
- **Ad account ID**: open Ads Manager; it's the `act=123…` number in the URL. Write it in `.env` with `act_` in front.
- **Page ID**: Business settings → Accounts → Pages → your Page → ID.
- **Pixel / Dataset ID**: Events Manager → Data sources → your dataset → ID.
- **Instagram account ID** (optional): Business settings → Accounts → Instagram accounts → ID.

---

## Step 3: Shopify app (Client ID + Secret)

Since 1 January 2026 you can't create new "custom apps" in the Shopify admin; the new way is the **Dev Dashboard**.
(If you already have an old custom app, you can put its Admin API token in `SHOPIFY_ACCESS_TOKEN` instead.)

1. Open https://dev.shopify.com/dashboard (log in with the store owner's account) → **Apps → Create app → Start from Dev Dashboard** → give it a name → **Create**.
2. On the **Versions** page:
   - **App URL**: `https://shopify.dev/apps/default-app-home` (the app won't be embedded, so this works)
   - **Scopes**: `read_orders` (required). Optional: `read_products` (matching by product handle), `read_all_orders` (orders older than 60 days; Shopify has to approve this one).
   - **Don't add any write scope.** This skill never writes to Shopify.
   - Protected customer data: catching duplicate orders needs the phone number. In the app settings, request protected customer data access (phone). Everything else works without it; only the duplicate check stays off.
3. Click **Release**.
4. Open the app → **Install app** → choose your store → **Install**.
5. Copy the **Client ID** and **Client secret** from the app's **Settings**.

Note: this only works when the app and the store are in the **same Shopify organization**. If you get `shop_not_permitted`,
that's the problem (see troubleshooting). The token lasts 24 hours; the skill fetches a fresh one every time.

---

## Step 4: Shiprocket (optional, but recommended)

Without it, the RTO rate and shipping cost come from the estimates in your `config.json`. With it, you get the **real** freight,
COD charge, RTO charge and delivered/RTO status for every order.

1. Shiprocket panel → **Settings → API → Configure → Create an API User**.
2. The email must be **different** from your main login. In module access, give read access to orders/shipments. You can set buyer details to "Not allowed".
3. The password is sent to your **main** registered email. Put that email + password in `.env`.

---

## Step 5: Fill in `.env` and `config.json`

In the skill folder (or the folder where you run Claude):

1. Make a copy of `.env.example` and name it **`.env`**. Fill in all values (Meta, Shopify, Shiprocket).
2. Make a copy of `config.example.json` and name it **`config.json`**. Put your **real** numbers in it:
   - `products`: each product's name, **cost** (product + packing, per unit), `handles` (the last part of the product URL: `/products/<handle>`), SKU.
   - `shipping.forward_per_order`, `rto_return_per_order`: what it costs to ship one order, and what an RTO costs to come back.
   - `cod_fee`: the courier's COD charge (flat ₹ or %).
   - `payment_gateway_fee_pct`: your PayU / Razorpay fee in %.
   - `rto.cod_rate_pct`, `rto.prepaid_rate_pct`: your RTO % (if Shiprocket is connected, the real rate comes from there).
   - `gst.sales_gst_registered`: `true` if you are GST registered and pay GST on sales.
   - `autopilot.max_total_daily_budget`: the daily budget limit for the whole account.
   - `comments.own_domains`: your website's domain, so your own links aren't counted as spam.
3. **Delete the `"_example": true` line.** While it's there, the skill won't report profit (the example numbers are fake).

What every key means: `references/config.md`.

**Credentials are in another folder?** Don't copy them; tell the skill where they are:
- Windows PowerShell: `$env:META_ADS_ENV_FILES="C:\path\one\.env;C:\path\two\.env"`
- Mac / Linux: `export META_ADS_ENV_FILES="/path/one/.env:/path/two/.env"`
- For the config: `META_ADS_CONFIG=/path/to/config.json`

---

## Step 6: First test

Open the skill folder in a terminal and run:

```bash
node scripts/check_setup.mjs
```

Or type this in Claude Code: **"Check my ads setup"**.

**How to know everything works:**
- Every line has a ✅, and at the end the "Jobs" list shows `✅ ready` next to 1–7.
- Then type "Send me today's report". The report's spend should roughly match today's spend in Ads Manager
  (in Ads Manager, keep the date on "Today" and the same account).
- In "Orders + RTO today?", clean orders should match today's orders in the Shopify admin (minus cancelled ones).
- If you see ❌, the "→" line under it tells you what to fix. Common errors are in `references/troubleshooting.md`.

---

## Using it on claude.ai (the website)

You can also upload the skill zip on claude.ai: **Customize → Skills → + → Create skill → Upload a skill**. (Code execution must be ON.)

**But there are two limits, which is why Claude Code is recommended:**
1. **Network:** the claude.ai code sandbox can usually reach only package sites (npm, PyPI, etc.). The Meta, Shopify and
   Shiprocket APIs may be blocked. If your plan has a network access setting (Settings → Capabilities), you'll have to allow
   `graph.facebook.com`, `<your-store>.myshopify.com` and `apiv2.shiprocket.in`. Without that, the scripts won't run.
2. **Secrets:** there you'd have to upload `.env` in every session, and your tokens would go into a cloud sandbox. On your own
   laptop with Claude Code, that problem doesn't exist.

---

## Security (please read)

- `.env` holds the keys to your ads and orders. Never share it, upload it or paste it into a chat.
- If a token leaks: Business settings → System users → your user → **Revoke tokens**, then make a new one.
  If the Shopify secret leaks: Dev Dashboard → app → Settings → rotate the secret.
- Without your "yes", the skill doesn't spend money, doesn't delete anything and doesn't run on a schedule by itself.
  Every change is logged in `~/.ratnakar-meta-ads/changes.log.jsonl`.

---

Made by **Ratnakar Content**.
