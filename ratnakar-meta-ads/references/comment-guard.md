# Comment guard (job 6)

## What it reads

Every ad that spent in the last `comments.lookback_days` (default 14) or is active now → its Facebook post
(`creative.effective_object_story_id`) and Instagram media (`creative.effective_instagram_media_id`). Many ads can share one
post; each post is read once. Comments by your own Page / Instagram account and comments that are already hidden are skipped.

## Categories and actions

Checked in this order (first match wins):

| Category | Detected by | Action |
|---|---|---|
| COMPLAINT | delivery not received, refund, return, wrong / damaged / fake product, fraud / scam / cheat / dhokha accusations, "worst", "bekar", "no response"… | **FLAG**. Never hidden by the skill. The owner replies publicly ("Sorry! Please DM us your order number") or decides to hide after resolving. |
| SCAM/SPAM LINK | any link or domain that is not in `comments.own_domains` (also wa.me, t.me, bit.ly) | HIDE (proposed) |
| ABUSE | profanity and slurs (English + Hindi in Roman script) | HIDE (proposed) |
| SPAM | "work from home", "earn daily", crypto, betting, "follow me", "check my profile", giveaways… | HIDE (proposed) |
| PHONE NUMBER | an Indian mobile number in a non-complaint comment | FLAG (could be a customer, privacy) |
| QUESTION | price, COD, "kaise order", "kab tak", "?" | REPLY (keep visible; answers sell) |
| OK | everything else | keep |

An angry complaint that also contains abuse is still a COMPLAINT (flagged, not hidden): a real customer problem must be seen.

Add your own words without touching the code: `comments.extra_spam_words`, `extra_abuse_words`, `extra_complaint_words`.
Very short abbreviations ("bc", "mc") are not in the default list because they also have innocent meanings.

## Hide, never delete

- Hidden comment: invisible to the public, still visible to the person who wrote it and their friends, can be unhidden. No drama.
- Deleted comment: gone forever, and the person notices. The skill has no delete call at all.
- Facebook: `POST /<comment-id>` with `is_hidden=true`, using a **Page** access token.
- Instagram: `POST /<ig-comment-id>` with `hide=true`.

## Permissions

| Action | Facebook ad posts | Instagram ad media |
|---|---|---|
| Read | Page token + `pages_read_engagement` + `pages_read_user_content` | `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement` (+ `ads_read`/`ads_management` when the Page role comes via Business Manager) |
| Hide | Page token + `pages_manage_engagement` (system user needs the Page's moderate task) | `instagram_manage_comments` |

The Page token is fetched automatically from the system-user token (`GET /<page-id>?fields=access_token`).
If Facebook reading fails, the script still shows Instagram (and vice versa) and prints which permission is missing.

## Flow

1. Dry run → three lists + a plan file with numbers for the HIDE list only.
2. The user picks numbers. Suggest replies for complaints and questions.
3. `--execute --plan <file> --approve 1,4 --note "<user's words>"` → each comment is re-read (skipped if already hidden) and hidden.
4. Every hide is logged to `changes.log.jsonl` (comment ID, ad, category, first 120 characters).
