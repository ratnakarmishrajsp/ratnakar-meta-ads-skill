# Meta Ads Autopilot: a Claude skill by Ratnakar Content

Let Claude run your Meta (Facebook + Instagram) ads for your Shopify store in India: COD, RTO and GST aware.
You talk to Claude in plain words; it runs scripts against the Meta, Shopify and (optional) Shiprocket APIs and brings back real numbers.

## ⬇️ Download

**[Download ratnakar-meta-ads-skill.zip](https://github.com/ratnakarmishrajsp/ratnakar-meta-ads-skill/releases/latest/download/ratnakar-meta-ads-skill.zip)**, then follow [SETUP.md](ratnakar-meta-ads/SETUP.md) (about 30–45 minutes, first time only).

## The 7 jobs

| # | Ask Claude | What you get |
|---|---|---|
| 1 | "Create a ₹500 sales campaign for tomorrow" | Campaign + ad set (+ ad), always created **PAUSED**. Turns ON only after your yes |
| 2 | "Send me today's report" | Spend, ROAS, CPA, purchases. Which ads are WORKING and which are BURNING CASH |
| 3 | "Am I really in profit?" | Real profit after product cost, shipping, COD, RTO and GST, checked against real Shopify orders |
| 4 | "Profit by product?" | P&L per product + break-even ROAS. Spots products that are quietly losing money |
| 5 | "Fix my ads" | Rule-based plan: pause losers, scale winners (max +20% per step). Nothing changes without your yes |
| 6 | "Clean my ad comments" | Hides spam, abuse and scam links. Flags genuine complaints for you. Never deletes |
| 7 | "Orders + RTO today?" | Orders, COD vs prepaid, fulfilment, RTO rate and NDR shipments |

More copy-paste prompts: [PROMPTS.md](ratnakar-meta-ads/PROMPTS.md).

## Safe by design

- Read-only by default. Anything that changes your ads runs only after you say **yes** in the chat.
- New campaigns are created PAUSED. Budgets go up at most 20% at a time and never past your caps.
- Comments are hidden, never deleted. Complaints are never hidden automatically.
- It never invents a number and always says where each number came from (Meta, Shopify, Shiprocket or your config).
- Your tokens stay in your own `.env` file on your laptop. Every change is logged.

## What you need

- [Claude Code](https://claude.com/claude-code) (Pro / Max / Team plan) and Node.js 18+
- A Meta ad account, a Shopify store, and optionally Shiprocket

---

Made by **Ratnakar Content**. Instagram [@ratnakarcontent](https://www.instagram.com/ratnakarcontent/) · YouTube [@ratnakarmishra06](https://www.youtube.com/@ratnakarmishra06)

This is a free tool shared as-is. Check every change before you approve it; you are responsible for your ad spend.
