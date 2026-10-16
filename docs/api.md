# API

The HTTP API the app uses. It is served by the in-browser backend, but nothing about it
is browser-specific: it's plain JSON over HTTP, defined by the schemas in
[`src/contract/`](../src/contract).

## Conventions

- **Bodies** are JSON; timestamps are ISO 8601 strings; money is an integer amount in
  minor units (`…Minor`) together with its ISO 4217 `currency`.
- **Errors** are `application/problem+json`
  ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)): `type`, `title`, `status`,
  `detail`, `instance` and a machine-readable `code`. Branch on `code`; show `detail` to
  people. `type` is an absolute URL to the problem's documentation page,
  `<origin>/problems/<slug>` (`sold_out` → `/problems/sold-out`); `instance` is the
  request's absolute URL.
- **Idempotency:** `POST /api/orders/:orderId/payments` requires an `Idempotency-Key`
  header. The response to an attempted charge is stored and replayed for any repeat of
  the same request — the same method, path and body, every field compared (by SHA-256
  hash, so no card details are stored). The same key with a different request is a
  `422 idempotency_key_reused`. Requests rejected before charging aren't stored, and keys
  expire after 24 hours, as Stripe's do.
- **Orders** need no key: one order per hold makes `POST /api/orders` a natural upsert.

## Endpoints

| Method and path                           | Body                                                                        | Success                                                                        | Problems                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/events`                         | —                                                                           | `200` `EventDto[]` with live `available` per tier                              | —                                                                                                                                                                           |
| `GET /api/events/:slug`                   | —                                                                           | `200` `EventDto`                                                               | `not_found`                                                                                                                                                                 |
| `POST /api/holds`                         | `{ eventSlug, items: [{ tierId, quantity }] }`                              | `201` `HoldDetailsDto` (`hold`, `event`, `order`, `serverTime`)                | `invalid_request`, `not_found`, `sold_out` (`tierId`, `available`)                                                                                                          |
| `GET /api/holds/:holdId`                  | —                                                                           | `200` `HoldDetailsDto`                                                         | `not_found`                                                                                                                                                                 |
| `POST /api/orders`                        | `{ holdId, attendees: [{ name, email }], addOns: { [addOnId]: quantity } }` | `201` created / `200` updated, `OrderDto`                                      | `invalid_request`, `not_found`, `hold_expired`, `payment_in_progress`, `already_completed`                                                                                  |
| `GET /api/orders/:orderId`                | —                                                                           | `200` `OrderDto`                                                               | `not_found`                                                                                                                                                                 |
| `POST /api/orders/:orderId/payments`      | `{ number, expiry, cvc, name }` + `Idempotency-Key`                         | `202` `{ payment, order }` — `processing`, or `requires_action` for 3-D Secure | `missing_idempotency_key`, `idempotency_key_reused`, `invalid_card`, `card_declined` (`paymentId`), `hold_expired`, `payment_in_progress`, `already_completed`, `not_found` |
| `POST /api/payments/:paymentId/challenge` | `{ decision: "approve" \| "reject" }`                                       | `202` `{ payment, order }`                                                     | `authentication_failed` (`paymentId`), `invalid_state`, `not_found`                                                                                                         |

A `202` never means "paid". The order becomes `paid` and then `fulfilled` when the
provider's webhook arrives; poll `GET /api/orders/:orderId` until its `status` settles.

## Order lifecycle

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> paid: webhook payment.succeeded
  pending --> failed: declined / authentication failed
  failed --> pending: new payment attempt
  pending --> expired: hold ran out, nothing in flight
  failed --> expired
  paid --> fulfilled: hold still live — tickets issued
  paid --> refunded: hold expired before the money arrived
```

Any other transition is a bug and throws (`assertTransition`).

## Test cards

| Number                | Outcome                                  |
| --------------------- | ---------------------------------------- |
| `4242 4242 4242 4242` | Succeeds                                 |
| `4000 0000 0000 0002` | Declined (`402 card_declined`)           |
| `4000 0025 0000 3155` | 3-D Secure challenge (`requires_action`) |
