# API notes (checked against the official docs in October 2026)

## Versions

| API | Version used | Why |
|---|---|---|
| Meta Marketing / Graph API | `v26.0` (override: `META_API_VERSION`) | Since the July 2026 auto-upgrade Meta answers every call (v20–v26) as v26.0 (see the `facebook-api-version` response header). v26 removed the `ids=` parameter, so the skill reads several objects through account edges with an `id IN [...]` filter. |
| Shopify Admin **GraphQL** API | `2026-10` (override: `SHOPIFY_API_VERSION_OVERRIDE`) | Latest stable, supported until Oct 2027. Shopify supports each version for ~12 months, then "falls forward" to the oldest supported one. REST Admin API is legacy; this skill uses GraphQL only. |
| Shiprocket | `https://apiv2.shiprocket.in/v1/external` | The only public version. |

Update the defaults in `scripts/lib/env.mjs` once a year.

## Auth

| Service | How | Lifetime |
|---|---|---|
| Meta | System User access token (Business settings → System users → Generate token) | No expiry ("Never"); invalid if revoked |
| Meta Page token (comments) | `GET /<page-id>?fields=access_token` with the system-user token | Derived each run |
| Shopify (Dev Dashboard app) | `POST https://<store>.myshopify.com/admin/oauth/access_token`, form-encoded `grant_type=client_credentials&client_id=…&client_secret=…` | 24 h (`expires_in` 86399); fetched each run. Only works when app and store are in the same Shopify organization. |
| Shopify (legacy custom app made before 2026) | static Admin API token in `SHOPIFY_ACCESS_TOKEN` | until revoked |
| Shiprocket | `POST /auth/login` `{email, password}` of an **API user** → Bearer token | 240 h (10 days); fetched each run |

## Calls per job

| Job | Calls | Permission / scope |
|---|---|---|
| 0 Setup | `GET /debug_token`, `GET /act_<id>`, `GET /<pixel>`, `GET /<page>?fields=access_token`; Shopify token + `orders(first:40)`; Shiprocket login + `/orders` | read only |
| 1 Campaign | `POST /act_<id>/campaigns` (OUTCOME_SALES, `daily_budget` in paise, LOWEST_COST_WITHOUT_CAP, PAUSED; `execution_options=["validate_only"]` for `--validate`), `POST /act_<id>/adsets` (OFFSITE_CONVERSIONS, `promoted_object {pixel_id, custom_event_type: PURCHASE}`, `targeting_automation.advantage_audience = 1`, no `publisher_platforms` = Advantage+ placements), `POST /act_<id>/adcreatives`, `POST /act_<id>/ads`, `POST /<id> {status: ACTIVE}` | `ads_management`, Page task ADVERTISE, pixel assigned |
| 2 Report | `GET /act_<id>/insights?level=ad&time_range=…` (spend, impressions, inline_link_clicks, actions, action_values), `GET /act_<id>/campaigns|adsets|ads` (status, budget, learning_stage_info) | `ads_read` |
| 3 Profit | Meta account insights; Shopify GraphQL `orders(query: "created_at:>=… AND created_at:<=…")`; Shiprocket `/orders?from&to` | `ads_read`; `read_orders`; Shiprocket API user |
| 4 Product P&L | as 3 + ad creatives (`object_story_spec`, `asset_feed_spec.link_urls`) and post `call_to_action` for landing pages | as 3 (+ Page token for post links) |
| 5 Autopilot | insights (lifetime + 3 days), `GET /act_<id>/activities`, `POST /<id> {status: PAUSED}` / `{daily_budget}` | `ads_read`, `ads_management` |
| 6 Comments | `GET /<post-id>/comments` (Page token), `GET /<ig-media-id>/comments`, `POST /<comment> {is_hidden: true}` / `{hide: true}` | see comment-guard.md |
| 7 Orders + RTO | Shopify orders; Shiprocket `/orders` (status, `awb_data.charges`, `shipments[].rto_initiated_date`) | `read_orders`; Shiprocket |

## Field facts and gotchas

- **Money units:** Meta budgets are in the currency's minor unit (paise for INR): ₹500 = `50000`. Insights `spend` is in rupees.
- **Spend is ex-GST** in Meta. India adds 18% GST on the invoice.
- **Purchases:** the skill reads the first of `omni_purchase`, `purchase`, `offsite_conversion.fb_pixel_purchase` that exists,
  so nothing is counted twice.
- **Timezones:** Meta insights use the ad account's timezone; Shopify stores often default to a US timezone. The skill always
  queries Shopify with explicit offsets (e.g. `2026-01-31T00:00:00+05:30`) in `config.timezone`.
- **Shopify 60-day limit:** without `read_all_orders` only the last 60 days of orders are visible.
- **Protected customer data:** without approval Shopify returns `phone` / `shippingAddress` as null (with an error). The
  skill drops those fields automatically and turns off the duplicate check, with a warning.
- **Shopify has no RTO status.** Orders show `returnStatus: NO_RETURN` even after an RTO, unless your team tags them.
  Shiprocket (or an RTO tag) is the only reliable source.
- **Shiprocket statuses:** `DELIVERED`, `RTO INITIATED`, `RTO IN TRANSIT`, `RTO DELIVERED`, `UNDELIVERED-1ST ATTEMPT` (NDR),
  `IN TRANSIT`, `OUT FOR DELIVERY`, `PICKUP SCHEDULED`, `NEW`, `CANCELED`… Check "RTO" before "DELIVERED" ("RTO DELIVERED"
  contains both). Charges per order: `awb_data.charges.freight_charges`, `applied_weight_amount`, `charged_weight_amount`,
  `cod_charges`, `applied_weight_amount_rto`, `charged_weight_amount_rto` (strings, may be empty before reconciliation).
- **Shiprocket order number:** `channel_order_id` = Shopify order number (digits of `#1234`).
- **Rate limits:** Meta returns codes 17 / 80004 when busy; the client waits and retries. Shopify GraphQL cost is kept low
  (40 orders × 15 line items per page) and throttling is respected.
- **Ad review:** after activation `effective_status` is `IN_PROCESS` / `PENDING_REVIEW` for minutes to hours. Normal.
- **validate_only:** Meta checks the payload and creates nothing. It needs real parent IDs, so only the campaign can be
  validated before anything exists.
