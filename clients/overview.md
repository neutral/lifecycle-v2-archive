# Foundation clients

Lifecycle's canonical CLI lives under [`runtime/`](../runtime/overview.md).
The installed terminal client lives under [`clients/tui/`](tui/overview.md)
and complements the CLI without replacing its effect boundary.

`clients/` owns terminal presentation. Connected clients consume Lifecycle's
shared [public protocol](../protocol/overview.md); the canonical CLI remains
with the Runtime because it owns installed effects. This collection owns no
Process engine, runtime state, read model, or authority route.

Runtime observations remain the only source of Delivery standing, Candidate
condition, activities, recovery, subjects, Journal summary, and eligible
operations.

The terminal client owns journey-first Founder orientation and exact Delivery
selection over Runtime-issued read models. It delegates non-authority
operations through the canonical CLI. Initialization, admission, acceptance,
no-ship, and recovery remain explicit canonical CLI handoffs.
