# Autopilot rules (job 5: "Fix my ads")

`scripts/autopilot.mjs` only proposes. It changes nothing until the user approves numbered actions, and it never
runs on a schedule by itself. Thresholds live in `config.json → autopilot`. A `null` threshold is derived from the
user's break-even (config costs + Meta's AOV), and the derivation is printed under "Sources used".

## Data it looks at

- Active campaigns, ad sets and ads, with `created_time`, budgets and `learning_stage_info`.
- Insights **since launch** (`date_preset=maximum`), or since `--since YYYY-MM-DD` for relaunched old campaigns
  (old lifetime numbers would hide what is happening now), and the **last 3 days** (today + 2 days).
- Budget changes in the Meta activity log (last ~4 days) and in this skill's own change log.

## Rules

| # | Rule | Default | Config key |
|---|---|---|---|
| A | **Ad stop-loss**: ad older than 24 h with spend since launch ≥ stop-loss and **0 purchases** → propose PAUSE ad. If it is the last active ad of its ad set, the plan warns that the ad set stops too. | stop-loss = 2 × break-even CPA | `min_age_hours_ad`, `stop_loss_spend` |
| B | **Ad set pause**: older than 72 h, not in learning, spend since launch ≥ pause floor, and ROAS below the pause line **both** since launch **and** in the last 3 days → propose PAUSE ad set. | floor = 3 × break-even CPA, line = break-even ROAS | `min_age_hours_adset`, `pause_min_spend`, `pause_roas_below`, `skip_if_learning` |
| B2 | **Protection**: an ad set whose 3-day ROAS is at or above the scale line is never proposed for pausing. | | |
| C | **Scale**: the budget owner (CBO campaign or ABO ad set) is older than 72 h, none of its ad sets is in learning, the last 3 days have ≥ 3 purchases at ROAS ≥ scale line, and the budget was not changed in the last 72 h → propose budget × (1 + 20%). | scale line = break-even ROAS × 1.3 | `scale_min_purchases`, `scale_roas_at_least`, `scale_margin_over_break_even`, `max_budget_increase_pct`, `min_hours_between_budget_changes` |
| D | **Caps**: a new budget never exceeds `max_daily_budget_per_item`, and the sum of all active daily budgets never exceeds `max_total_daily_budget`. A winner at the cap is listed as "at the budget cap", not scaled. | none (set them!) | `max_daily_budget_per_item`, `max_total_daily_budget` |

Every item that is **not** changed is listed with the reason (too young, learning, protected, not enough purchases,
changed recently, at cap). That list matters as much as the changes.

## Why these rules

- **Age first.** Delivery and attribution are noisy in the first 1–3 days; a campaign that looks dead on day 1 is often fine on day 3.
- **0 purchases at 2 × break-even CPA** is the clearest loser signal and is cheap to reverse (unpause).
- **Two windows must agree** before an ad set is paused, so one bad day never kills a good ad set.
- **+20% per 72 h** because large jumps push the ad set back into learning and usually raise CPA.
- **Caps** stop a runaway scale-up from spending more than the business can fund (prepaid UPI top-ups, COD cash cycle).

## Execution safety

1. The plan file stores the exact before-state (status, budget, name) and is valid for `plan_valid_hours` (default 6 h).
2. `--execute --plan <file> --approve 1,3` re-reads each object; if its name, status or budget changed, that action is skipped.
3. Each write is read back, then logged with the user's words (`--note`) to `changes.log.jsonl`.
4. There is no "approve everything automatically" mode. `--approve all` exists only for when the user literally says "sab karo".

## What it does not do (on purpose)

- It does not create or delete anything, change bids, audiences, placements or creatives.
- It does not lower budgets (pausing a loser is clearer than starving it). Suggest it in words if needed.
- It does not judge on Shopify revenue per campaign (Shopify cannot tell which campaign an order came from reliably);
  use job 3/4 for the real-money check before big moves.
