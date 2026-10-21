# Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `Meta API error 190` | Token expired, revoked or copied wrong | Generate a new System User token (SETUP step 2c), paste it into `.env` without quotes or spaces |
| `Meta API error 10` / `200` / "requires … permission" | Permission missing on the token, or the asset is not assigned to the system user | Add the permission when generating the token; assign the ad account / Page / pixel to the system user |
| `(#10) This endpoint requires the 'pages_read_user_content' permission` | Facebook comments need it | Add `pages_read_user_content` (+ `pages_manage_engagement` to hide) and regenerate the token |
| "requires advanced access" on a Page permission | The app is not allowed this permission for assets outside your business | Make sure the Page is owned by (or shared with) the same Business Portfolio as the app and system user |
| `Meta API error 100` | Wrong ID (ad account, Page, pixel) | Check the IDs in `.env`; ad account must look like `act_<number>` |
| `Meta API error 17` / `80004` | Rate limit | The script retries; if it keeps failing, wait 15 minutes |
| `Shopify login failed: shop_not_permitted` | App and store are not in the same Shopify organization | Create the app in the Dev Dashboard of the organization that owns the store |
| `Shopify login failed: app_not_installed` or HTML page | App not installed on the store, or wrong store domain | Install the app (Dev Dashboard → app → Install app); use `<store>.myshopify.com`, not your custom domain |
| `Shopify API refused access (HTTP 401/403)` | Missing `read_orders`, or a new scope not yet approved | Add the scope to a new app version, release it, approve the update on the store |
| "duplicate orders could NOT be removed" | No protected customer data (phone) access | Request phone access for the app; until then duplicates are counted as clean (the report says so) |
| Only the last 60 days of orders | No `read_all_orders` | Request it in the app settings, or use windows within 60 days |
| `Shiprocket login failed` | Using the normal panel login, or wrong password | Create an API user (SETUP step 4); its password is mailed to your main email |
| "payment type unknown" | Your gateway name is not in the regex | Add it to `orders.prepaid_gateway_regex` (or `cod_gateway_regex`) in config |
| "Ads not linked to a known product" | Ad link handle is not in `config.products[].handles` | Add the handle, or a `campaign_product_map` rule |
| `Config … still has "_example": true` | Template numbers not replaced | Fill your real costs, delete the line |
| Meta spend ≠ Ads Manager | Different date or timezone, or today still running | Compare the same date; account timezone is shown in the report |
| Shopify orders ≠ admin count | Admin counts cancelled / test orders too, or a different timezone | Compare "Gross orders" with the admin list for the same IST day |
| `Safety stop: a write was attempted without --execute` | A bug or a mistaken call | Nothing was sent. Re-run the dry run, then `--execute` with the plan |
| `Plan is … h old` | The plan expired | Run the dry run again so decisions use fresh data |
| `node: command not found` | Node.js not installed | Install the LTS version from nodejs.org, open a new terminal |
