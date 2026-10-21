# Formulas: clean orders, ROAS and real profit

All numbers in the examples below are **made-up examples**, not anyone's real data.

## 1. Clean orders ("Actual Real Clean" numbers)

Start from every Shopify order created in the window (business timezone, default IST) and remove:

| Removed | Rule |
|---|---|
| Test orders | Shopify `test = true` |
| Cancelled | `cancelledAt` is set |
| Excluded tags | any tag in `orders.exclude_tags` (e.g. `test`, `fake`) |
| Duplicate submissions | same phone (last 10 digits) **and** the same items within `orders.duplicate_window_hours` (default 24 h). The first order is kept. A repeat buyer who orders different items, or orders again after the window, is NOT a duplicate. |

What is left = **clean orders** and **clean revenue** (Shopify `currentTotalPrice`, i.e. after edits and refunds).

**Prepaid vs COD** is decided by the payment gateway names on the order, not by "paid" status:
- COD if any gateway matches `orders.cod_gateway_regex` (default: cod, cash on delivery)
- Prepaid if a gateway matches `orders.prepaid_gateway_regex` (PayU, Razorpay, Cashfree, PhonePe, Paytm, cards, UPI…)
- Otherwise "unknown", which is treated as COD (the riskier case) and reported as a warning.

A delivered COD order is marked "Paid" by Shopify after the courier remits the cash. It is still COD.

## 2. The different ROAS numbers

| Name | Formula | Use |
|---|---|---|
| Meta ROAS | Meta purchase value ÷ Meta spend (ex-GST) | What Ads Manager shows; includes view-through, cancelled and duplicate checkouts |
| Actual clean ROAS | clean Shopify revenue ÷ Meta spend (ex-GST) | Real money in; also counts orders from other channels (it is a blended MER) |
| Clean ROAS after RTO | (clean revenue − expected RTO lost sales) ÷ Meta spend | Revenue you expect to actually collect |
| Break-even ROAS | see section 4 | The clean ROAS at which profit is zero |

**Prepaid Day-0 recovery %** = prepaid revenue ÷ Meta spend × 100: the share of today's ad spend already back in the bank.

## 3. Profit per order (contribution before ads)

Per clean order, with `r` = RTO probability (COD rate or prepaid rate; `r = 0` if Shiprocket says DELIVERED, `r = 1` if RTO):

```
net price         = price − GST on sales (only if GST registered)
lost to RTO       = r × net price                    (an RTO order brings no money)
product cost      = (1 − r) × product cost + r × RTO packaging loss   (the product comes back on RTO)
forward shipping  = paid on every shipped order
RTO shipping      = r × return shipping
COD fee           = (1 − r) × COD fee   (+ r × COD fee if your courier charges it on RTO too)
gateway fee       = prepaid only: price × gateway %
contribution      = price − GST − lost to RTO − product cost − forward shipping − RTO shipping − COD fee − gateway fee
```

When Shiprocket is connected, its real per-order `freight`, `COD` and `RTO` charges replace the config values.

```
net profit = Σ contribution − ad cost
ad cost    = Meta spend × (1 + Meta GST %)      (just Meta spend if you claim the GST input credit)
```

## 4. Break-even ROAS (and why the short formula needs care)

```
break-even ROAS = revenue × (1 + Meta GST %) ÷ contribution          (summed over the orders)
break-even CPA  = contribution per order ÷ (1 + Meta GST %)           (ex-GST, comparable with Ads Manager CPA)
```

The short version people use is:

```
break-even ROAS = AOV ÷ (AOV − product cost − shipping − COD fee − expected RTO cost − payment fee − GST)
```

It gives the same answer **only if** "expected RTO cost" is the full loss of an RTO, not just the return freight:

```
expected RTO cost = r × (AOV − GST − product cost − COD fee + return shipping + RTO packaging loss)
```

i.e. the sale you lose, minus the product you get back and the COD fee you don't pay, plus the return freight.
Then multiply by (1 + Meta GST %) if you pay GST on ads and don't claim it back.

### Worked example (made-up numbers)

AOV ₹800, product cost ₹150, forward shipping ₹65, return shipping ₹60, RTO packaging loss ₹15, COD fee ₹35,
gateway fee 2%, COD RTO 22%, prepaid RTO 5%, 80% of orders COD, not GST registered, Meta GST 18%.

| | COD order | Prepaid order |
|---|---|---|
| Lost to RTO | 0.22 × 800 = 176.0 | 0.05 × 800 = 40.0 |
| Product cost | 0.78 × 150 + 0.22 × 15 = 120.3 | 0.95 × 150 + 0.05 × 15 = 143.3 |
| Forward shipping | 65.0 | 65.0 |
| RTO shipping | 0.22 × 60 = 13.2 | 0.05 × 60 = 3.0 |
| COD fee | 0.78 × 35 = 27.3 | 0 |
| Gateway fee | 0 | 0.02 × 800 = 16.0 |
| **Contribution** | **398.2** | **532.8** |

Mix (80% COD): 0.8 × 398.2 + 0.2 × 532.8 = **₹425 per order** before ads.
Break-even ROAS = 800 × 1.18 ÷ 425 = **2.22x**. Break-even CPA = 425 ÷ 1.18 = **₹360** (ex-GST).

The short formula with "RTO cost = 0.22 × ₹60 return freight" would say 800 ÷ (800 − 150 − 65 − 35 − 13.2) = **1.49x**, far too low:
you would keep ads running that lose money on every order. With the full RTO cost (0.22 × 690 = 151.8) it gives
800 ÷ 398.2 = 2.01x for a COD order, × 1.18 = 2.37x incl. Meta GST, matching the table.

## 5. What is never done

- No number is filled in when an input is missing (cost of an unmapped product, RTO rate, shipping): the script lists it as missing.
- Meta and Shopify are never mixed silently: Meta numbers are labelled "Meta-reported".
- Today's RTO is always an expectation; it is labelled so.
