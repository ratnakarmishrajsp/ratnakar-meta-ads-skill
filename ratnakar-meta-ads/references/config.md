# config.json: every key

Copy `config.example.json` → `config.json`, fill in **your** numbers, delete `"_example": true`. Keys starting with `_` are notes.
Missing keys fall back to safe defaults; costs never get a made-up default (the scripts say what is missing).

| Key | Meaning | Example value in the template |
|---|---|---|
| `currency`, `timezone` | Reporting currency and business timezone. Days are calendar days in this timezone. | `INR`, `Asia/Kolkata` |
| `products[]` | One entry per product you sell: `name`, `cost` (landed cost of ONE unit incl. packing), and how to recognise it: `handles` (from `/products/<handle>`), `skus`, `title_contains` (text in the line-item title). Bundles get their own entry with the bundle cost. | 2 example products |
| `default_product_cost` | Cost used for a line item that matches no product. `null` = report it as missing instead. | `null` |
| `campaign_product_map[]` | When an ad has no product link: `{ "campaign_name_contains": "X", "product": "<products.name>" }` or `ad_name_contains`. | 1 example |
| `shipping.forward_per_order` | What you pay to ship one order (used when Shiprocket has no charge for it). | 65 |
| `shipping.rto_return_per_order` | What an RTO costs to come back. | 60 |
| `shipping.rto_packaging_loss` | Packaging / damage lost on each RTO (product itself comes back). | 15 |
| `shipping.use_shiprocket_actuals` | Use Shiprocket's real per-order freight / COD / RTO charges when available. | `true` |
| `shipping.shiprocket_add_gst_pct` | Set to 18 if your Shiprocket invoices add GST on top of the charges the API shows (check one invoice). | 0 |
| `cod_fee.flat`, `cod_fee.pct_of_order` | Courier COD charge: flat ₹ and/or % of order value. | 35, 0 |
| `cod_fee.charged_on_rto` | `true` if the COD fee is charged even when the parcel comes back. | `false` |
| `payment_gateway_fee_pct` | Gateway fee on prepaid orders. | 2 |
| `rto.source` | `auto` (Shiprocket → Shopify tags → config), `shiprocket`, `shopify`, or `config`. | `auto` |
| `rto.cod_rate_pct`, `rto.prepaid_rate_pct` | Your RTO % when no better source is available. | 22, 5 |
| `rto.shopify_rto_tags` | Tags your team puts on RTO orders in Shopify. | `["RTO"]` |
| `rto.lookback_days` | Days of shipments used to measure the RTO rate. | 30 |
| `rto.min_closed_shipments` | Minimum delivered + RTO shipments before a measured rate is trusted. | 20 |
| `gst.sales_gst_registered` | `true` if you are GST registered and pay GST on sales. | `false` |
| `gst.sales_gst_pct`, `gst.prices_include_gst` | Your product GST rate and whether website prices include it (Shopify's tax line is used when present). | 18, `true` |
| `gst.meta_gst_pct`, `gst.claim_meta_gst_credit` | GST on Meta invoices; `true` if you claim it back as input credit. | 18, `false` |
| `orders.duplicate_window_hours` | Same phone + same items within this window = duplicate. | 24 |
| `orders.exclude_tags` | Orders with these tags are removed from clean orders. | `["test","fake"]` |
| `orders.cod_gateway_regex`, `orders.prepaid_gateway_regex` | How payment gateway names are classified. Add your gateway if the report shows "payment type unknown". | see file |
| `assumptions.aov`, `assumptions.cod_share_pct` | Only used by the Meta-only report and the autopilot to estimate break-even when there are no purchases yet. | 850, 75 |
| `report.burning_cash_spend` | Spend with 0 purchases that counts as BURNING CASH. `null` = 2 × break-even CPA. | `null` |
| `report.min_spend_to_judge` | Below this spend a zero-sale item is "TOO EARLY". `null` = 1 × break-even CPA. | `null` |
| `autopilot.*` | See `autopilot-rules.md`. `null` thresholds are derived from break-even. **Set `max_total_daily_budget`.** | see file |
| `campaign_defaults.*` | Country, age range, name prefix and URL tags (UTM) for new campaigns. | IN, 18–65 |
| `comments.own_domains` | Your own domains, so your links are not treated as spam. | `["yourstore.in"]` |
| `comments.extra_*_words` | Extra words for spam / abuse / complaint detection. | `[]` |
| `comments.lookback_days` | How far back comments are listed. | 14 |

## Where the files are looked for

- Config: `--config <file>` → `META_ADS_CONFIG` → `./ratnakar-meta-ads.config.json` (current folder) → `<skill folder>/config.json`.
- Credentials: real environment variables → files in `META_ADS_ENV_FILES` → `<skill folder>/.env` → `./.env`.
- Plans and change log: `META_ADS_DATA_DIR` (default `~/.ratnakar-meta-ads`).
