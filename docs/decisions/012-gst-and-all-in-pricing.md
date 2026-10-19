# 012 — All-in prices, with GST worked out per ticket

**Status:** Accepted. Amends the fee rule in [008](008-money-and-time-zones.md).

## Context

Tickets showed a base price, and a 3% fee appeared only at checkout. That's **drip
pricing**: a buyer compares one price and is charged another. It's now unlawful in both
of the checkout's markets:

- India's **Guidelines for Prevention and Regulation of Dark Patterns, 2023** (Central
  Consumer Protection Authority) name drip pricing as a dark pattern.
- The US **FTC Rule on Unfair or Deceptive Fees** (in force 12 May 2025) requires
  live-event ticket sellers to show the total price, mandatory fees included, from the
  first price shown, and more prominently than any other price.

The prices also carried no tax. GST on admission to concerts and theatre is 18%, and
admission of **₹500 or less per person is exempt**. That threshold dates from January
2018 and survived the GST rate changes of 22 September 2025, whose 40% rate is for
casinos, race clubs and IPL-type events, not ours. A booking fee is a service, taxed
at 18% whatever the ticket costs.

## Decision

- **Every price a buyer sees is all in:** the tier picker, seat labels, the legend, the
  home page's "from" prices and the extras. Each tier says what its price is made of
  ("Ticket ₹1,200.00 + booking fee ₹36.00 + GST ₹222.48"), and the order summary lists
  the booking fee, each GST line and the total.
- **One pricing engine, `core/pricing.ts`,** used by the server's charge and by every
  label on screen, so they can't disagree. Catalogue prices stay before tax, and the fee
  and GST are worked forward from them.
- **The rules are data** (`PRICING_RULES`): the fee rate, the admission rate and its
  threshold, and the rate on services. Rates change, as they did in 2025, and a change
  of rate should be a one-line, reviewable data change.
- **Worked out per ticket, in paise, rounding half-up.** One ticket's all-in price times
  the quantity is exactly that line's cost, so a price label never disagrees with the
  total by a paisa.
- **GST is two halves, each rounded:** CGST and SGST at 9% each, never 18% split in two
  afterwards. That keeps both halves in whole paise: 18% of ₹74.97 is 1,349.46 paise,
  but two 9% halves are 675 + 675.
- **The booking fee is 3% of each ticket,** and no longer 3% of the tickets and extras
  together. Extras carry their own GST rate and no fee.
- **The contract grows, additively:** `amounts` gains `taxMinor` and `taxLines`
  (`kind`, `rateBasisPoints`, `taxableMinor`, `amountMinor`). An exempt ticket is a tax
  line at 0%, so the summary can say there's no GST on it rather than leave it out.

## Consequences

- The first price a buyer sees is what Pay charges, and an end-to-end test checks it.
- Rounding per ticket can differ from rounding the order's total by a paisa or two.
  That's the trade for labels that always agree with the total.
- **Illustrative, not tax advice:** the rates on extras (5% on food and merchandise,
  18% on a printed programme) show that extras can differ. They aren't claimed as the
  right rates for those goods.
- Left out, deliberately:
  - tax invoices;
  - IGST instead of CGST and SGST, which depends on the place of supply;
  - e-invoicing;
  - tax collected at source by e-commerce operators;
  - rounding an invoice to the rupee.
