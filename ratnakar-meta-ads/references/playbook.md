# Playbook: lessons from running a real COD-heavy D2C account

These lessons come from months of running Meta ads for an Indian Shopify brand (mostly COD, Shiprocket shipping) with AI
agents, including the mistakes an earlier agent made that cost real money. They are written as rules so any store can use
them. Read this before giving strategy advice. No numbers here are from that account; they're illustrations.

## 1. The loop for every task

**Observe → Diagnose → Decide → Act safely → Verify → Log → Learn.**
Pull live data first (never answer from memory or an old report). Find the cause, not the symptom. Decide with the user's own
break-even. Change only with a yes. Read back what you changed ("success: true" is not verification). Log it.

## 2. Diagnosis ladder: "orders kyun kam hain?"

Check top to bottom; the cheap, common causes come first. Tell the owner the one or two causes that matter, with numbers,
and also what is **not** the problem.

| Rung | Question | How to check |
|---|---|---|
| 1 Money / delivery | Did ads actually run all day? | Spend by hour, account balance / spend cap, account status. Prepaid (UPI top-up) accounts go dark when the balance runs out, often in the evening, which is usually the cheapest time to buy. |
| 2 Account / ad status | Rejected ads, limits? | `effective_status`, review feedback, account status (job 2 alerts) |
| 3 Tracking | Does Meta see the sales? | Meta purchases vs Shopify clean orders per day (job 3). A sudden gap = pixel / checkout tracking problem. |
| 4 Front-end | Are people clicking? Fatigue? | CTR, CPC, CPM, frequency per ad, this week vs last week |
| 5 Site funnel | Where do clickers drop? | click → page view → add to cart → checkout → purchase. With a third-party checkout (Shiprocket Checkout, GoKwik…) the checkout drop-off is visible only in that app's dashboard, not in Shopify's abandoned checkouts. |
| 6 Product mix | Is one product dragging? | Job 4 |
| 7 Outside world | Festival, sale season, payday, competitor? | Calendar. Before festivals, gifting angles work; stop pushing "deliver before the festival" offers once courier time runs out. |

## 3. Account structure that worked

- **Simple wins:** 1 campaign → 1 ad set → 1–3 ads, campaign budget (CBO), Sales objective optimised for Purchase,
  broad country targeting, age 18–65, all genders, **Advantage+ audience and Advantage+ placements**, no interests.
- **Manual placements lost money.** Restricting to "Feeds + Reels only" excluded cheap inventory (WhatsApp Status, Stories)
  that had been bringing the cheapest purchases. Let Meta place the ads.
- **Don't shred the budget.** Many tiny ad sets (a very small daily budget each, several ads each) never get enough data: most ads
  get almost no spend and nothing is learned. Fewer ads, more budget per test.
- **One test = one campaign, 2–3 ads, one variable changed.** Judge it after ~72 h and a spend of a few times your target CPA,
  not after one day.
- **Fair test:** Meta often pours money into one ad early, even a weak one. If that ad has poor CTR and high CPC after ~1–1.5×
  target CPA, pause it so the other ads get budget.

## 4. Protect winners

- **Reuse, don't copy.** To use a winning ad in another campaign, reuse its `creative_id` or Page post (same post = same likes,
  comments and social proof). Duplicates that re-upload the video start from zero and usually do worse.
- **Never edit a live winner's creative** (video, text, link). It resets learning. Make a new ad instead.
- **No knee-jerk kills.** Winners were paused after 1–2 weak days and lost; a relaunch of one of them sold again within hours.
  72 h no-touch for new campaigns; judge on 3-day windows.
- **Scale slowly.** A winner pushed up very fast (budget more than doubled in about a week) collapsed. Max +20% per 72 h.
- **Honest names.** Name ads by what they are ("Product X | founder video | COD hook"). Never put results in names
  ("WINNER 5x", "200 orders"); the labels were wrong within days and misled every later decision.

## 5. Creative ↔ product ↔ link must match 1:1

Before any ad goes live, check three things together, with zero tolerance:
1. **The video/image:** which product, which pack (single / combo), which price or offer is shown **and spoken**.
   Listen to the audio; don't trust the file name.
2. **The copy:** primary text and headline say the same product, pack and offer, in the same hook as the video.
3. **The link:** goes to that exact product page (not the home page, not a different pack), answers HTTP 200 and is in stock.

Also: every claim in the ad (natural, long-lasting, free shipping, COD) must already be on the landing page.
Upload original full-resolution video files (1080×1920 for Reels), not compressed copies. Make captions readable on mute.

## 6. The website is a money machine

- No theme, checkout, variant, price, image or URL change without the owner's OK, and always compare click → add-to-cart
  rate before vs after. An unmeasured "improvement" once cut add-to-cart rate by a lot.
- **After any store change or migration, check that every live ad's link still returns 200.** A migration once left a
  best-seller's page missing, and its ads sent paid traffic to a 404 for days.
- Never redirect a product URL to a *different* product. Never rename a handle that ads link to.

## 7. Money facts owners forget

- Meta spend is ex-GST; the bank pays +18%.
- On prepaid (UPI top-up) accounts, Meta spends **by budget, not by balance**. More balance doesn't mean more spend; it means
  no dark hours. Daily ad spend ≈ top-up ÷ 1.18. Top up the night before or early morning.
- Separate the two "per order" costs when explaining: product + shipping cost per order vs ad cost per order (spend ÷ orders).
  A cash-box example works best: "₹X spent, N orders, R% RTO → delivered × price in, ads + product + shipping + RTO out = profit".
- COD reality: some orders are duplicates (customer submits twice), some get cancelled, 15–30% may come back (RTO).
  Calling NDR customers (failed delivery attempt) the same day is the cheapest RTO saver. A small prepaid discount moves
  buyers to prepaid, which returns far less.
- 1 order is a signal, not a winner. 3–5+ purchases above break-even is a winner.

## 8. Fail loudly

- An uninstalled Shopify app once made a daily report show "0 orders" on real order days. If an API fails, put the error at
  the top and never print 0 for data you didn't get.
- Watch the spend cap / account balance: delivery stops silently when it runs out.

## 9. Talking to the owner

- First line = the answer. Short tables. Exact Ads Manager names and IDs.
- Say what you could not verify, and the assumption you are least sure of (ask it once, e.g. "do you pay GST on sales?").
- When the owner disagrees ("checkout theek hai"), note your number once, accept their check, and move to the next rung.
- End with numbered decisions, each with your recommendation.
- Ambiguous instruction? Pick the reading that matches your last proposal, do it only if it's reversible, and say in one line
  what you did and how to undo it.

## 10. Keep one source of truth

The earlier agent wrote hundreds of one-off scripts and no state file, so every session re-audited from scratch and repeated
mistakes. Use these scripts, keep the change log, and write down what was launched, when, and why.
