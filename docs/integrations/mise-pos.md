# QR Menu → Mise POS integration (groundwork)

Mise POS is a **separate project with its own Supabase** (see memory: POS separation).
This document describes the stable contract laid down in the QR-menu so a future sync can be
built without schema churn. **The sync itself is not implemented yet** — this is the seam.

## What already exists (laid down in this iteration)

`menu_orders` carries everything POS needs:

| column        | meaning                                              |
|---------------|------------------------------------------------------|
| `id`          | order id (returned by `POST /api/menu/order`)        |
| `restaurant_id` | tenant                                             |
| `menu_id`     | which menu the order came from                        |
| `items`       | `[{ id, name, price, qty, opts[] }]` (JSONB)         |
| `total`       | items subtotal (no tip)                              |
| `tip`         | tip amount                                            |
| `order_type`  | `dine_in` \| `pickup`                                |
| `source`      | `qr`                                                  |
| `table_number`| table marker from `?table=N`                          |
| `status`      | `new` → `in_progress` → `done` → `cancelled`          |
| `synced_at`   | set when the order has been pushed to POS (nullable)  |
| `pos_order_id`| id of the mirrored order inside Mise POS (nullable)   |

`POST /api/menu/order` returns `{ ok: true, id }` so a caller can correlate.

## How to wire the sync later (recommended)

1. **Outbound, behind a feature flag.** In `app/api/menu/order/route.ts`, after the insert,
   if a flag/env (e.g. `POS_SYNC_URL` + per-restaurant opt-in) is present, `POST` the order
   payload to the Mise POS ingest endpoint. On success, write back `synced_at` and
   `pos_order_id`. Keep it best-effort (never block/fail the guest order on POS errors).
2. **Idempotency.** Send the `menu_orders.id` as an idempotency key so retries don't duplicate.
3. **Backfill / retry.** A small cron can pick up rows where `status='new' AND synced_at IS NULL`
   and retry, so a POS outage doesn't drop orders.
4. **Menu mapping.** POS items differ from menu items; map by a shared external id or by name.
   Prefer storing a POS item id on `menu_items` (add `pos_item_id` when that work starts).

## Do NOT

- Do not import Mise POS Supabase credentials into mise-app directly; cross-project writes go
  through an HTTP ingest endpoint owned by POS.
- Do not change the `menu_orders` columns above without updating the POS ingest contract.
