# Pick injury-designation display — inactive consumer proposal

This is an additive, inactive presentation slice. No production page, loader, build allowlist, availability source, collector, model, selector, result, financial tracker or immutable edition consumes it. It must remain draft until Implementation and Publishing approve the source/status projection and activation separately. The synthetic preview is a development fixture, not a real player or offer.

## Consumer behavior

| Reliable saved status | Compact display | Saved price / authority |
| --- | --- | --- |
| Questionable / GTD | QUESTIONABLE / GTD, reported time | Original saved price. The tag alone does not exclude the pick. Other eligibility/model holds are unchanged. |
| Probable / Doubtful | Explicit designation and reported time | Informational display only; no selection policy is implemented here. |
| Available, fresh explicit update | Remove injury flag, show unobtrusive Available update time | Original saved price. Absence from a feed is never clearance. |
| Out effective after actual first-row publication, captured before scheduled start, fresh and reliably bound, no verified participation, event scheduled/live | Red OUT flag and **VOID / SBOS provisional** in price slot | Original posted quote and its real clock stay in expandable details. No sportsbook-settlement, statistical-result, refund or exposure write. |
| Out effective before posting / actual posting unknown / captured after scheduled start / verified played / final or changed event | Red OUT plus explicit review reason | Original saved price; no automatic VOID. Known deployed presence is not actual first publication. |
| Stale / conflicting / unknown / unverified | Explicit warning; any last verified designation is labeled historical | No inferred Available or current VOID. Preserve original quote and unknown clocks. |

Normal status details explain that saved forecasts may be conditional on participation. A status tag never promotes a held model or authorizes a recommendation. A provisional display must never be passed to `resultFor`, `isVoidedLeg`, payout/stake/record calculations or persisted settlement. Book-specific terms and participation may make actual wager settlement differ.

## Minimal allowlisted projection and host context

`assets/pick-designation.js` exposes `buildView(record, context, options)`, `render(...)`, and `mount(container, ...)`. It performs no fetch, persistence, timer, eligibility decision or source import. No host is wired to it. `mount` replaces the supplied display subtree each time so an explicit Available/unknown update cannot leave a superseded OUT/VOID tag behind.

Record fields, all explicit:

- `schemaVersion: "sbos-public-pick-designation-1"` and `dataKind: "accepted_public" | "synthetic"`.
- `binding`: `recordId`, `editionVersion`, `slateDate`, canonical `eventId` / `playerId`, exact `book`, `market`, raw `operator` / numeric `line`, `period`, `product`, `overtime`, `settlementRules`, `jurisdiction`, `startTime`. Terms may be null; a provisional display does not verify them. No cross-book/raw-line/operator aliasing.
- `asOf`: projection clock, distinct from source facts.
- `state`: `current | stale | unknown | conflicting | unverified`.
- `designation`: `available | questionable | gtd | probable | doubtful | out`, or explicit null for unknown/conflicting/unverified state.
- `source`: `name`, `effectiveAt`, `reportedAt`, `observedAt`, `validUntil`; explicit null for unknown/conflicting/unverified state. Current/stale facts require known effective/observed clocks; `reportedAt` may be honest null. An observed timestamp is labeled observed and never relabeled reported. Unverified/missing timing must not be fabricated to fit this shape.
- `lastVerified`: optional `{designation, source}`, otherwise null. It is historical context, not an automatic current fallback. Unknown/stale/conflicting updates retain its visible historical Q/GTD/Out flag; only explicit reliable Available clears the injury tag.

The host independently supplies `dataKind`, identical `binding`, immutable `originalSelection: {americanOdds, capturedAt, selectedAt}` with honest nulls, `publication: {kind, at}`, `eventStatus`, and `participation`. Publication kind is `actual_first_row_publication`, `first_known_deployed_presence`, or `unknown`. Event status is `scheduled | live | final | postponed | canceled | unknown`. Participation is `unverified | played | inactive`; appearance must come from the separately reviewed actual-stat/participation path, not from missing data.

`dataKind` and `state` are structural fields, not authentication or a publishing permit. Production input must come from an independently reviewed minimal public projection with actual source/mapping evidence; toggling a field does not authorize adoption. Synthetic data is refused by default and requires explicit `allowSynthetic: true` for a local preview. Unknown/private fields and property accessors reject without invocation. Whole private search/status packages must not be imported into the public client.

Source names are bounded public labels. Private source payloads, catalogue paths, model facts, receipts, credentials, raw provider IDs and unreviewed URLs are not part of the contract. The renderer does not return raw input objects or forecasts.

## Timing and conservative holds

Strict ISO clocks retain 0–9 fractional digits with integer nanosecond comparison, explicit timezone and calendar validation. `effectiveAt <= observedAt <= asOf <= now`; when reported time is known, `effectiveAt <= reportedAt <= observedAt` also applies. Caller-supplied `validUntil` must not predate observation and expires at its cutoff. The projection owner must define and review freshness policy; the client invents no six-hour/day-wide clearance window and cannot extend it. Display timestamps use Eastern dates/timezone and retain the exact source string in the `time` element.

To show provisional VOID: exact actual publication is required, `effectiveAt > publication.at` strictly, both effective/observed clocks precede scheduled start, event is scheduled/live, and participation is not verified played. Capture time alone cannot turn an old Out fact into a post-publication update. Unknown actual tip/offered terms remain unknown; the scheduled-start guard is deliberately conservative. Final results remain owned by the separate result path. This is consumer safety behavior proposed for review, not a new engine/selection policy.

Stale Available is not current clearance. Stale Out is shown only as historical with an explicit refresh warning, never as current sportsbook VOID. Conflicting/unknown/unverified states cannot clear or void based on prior facts. Same-effective-time contradictory current/prior facts reject rather than resolving by input order.

## Ownership and activation requirements

Implementation owns `tools/parlay-search/` and its proposed typed status policy; Interface owns this public display slice. No edits to that private tool path are included. The schemas must be reconciled through an explicit small adapter/projection review, not a wholesale private import. Draft implementation here does not approve engine, quote, role, joint-probability or exposure gates.

Publishing must review source reliability, event/player mapping, clock provenance, conflict/correction ordering, explicit Available evidence, the freshness policy, after-posting proof, actual-participation precedence and final-result/financial isolation before activation. The current public `assets/availability.js` collapses non-Out statuses and can write announcement-based `row.result`; reusing that path would defeat the separation in this proposal. Migration of that behavior is a separate reviewed integration requirement.

Production integration must cover shared pick rows, personal favorites and each parlay leg while leaving ticket price/settlement and immutable posted exposure intact. It must not apply a leg's provisional VOID to an entire posted parlay or calculate a sportsbook payout from it. Research needs the same exact-bound informational status without bypassing its probability reader or holds. All of those actual consumer integrations remain inactive/pending in this draft.

Validation: `node --test tests/pick-designation.test.cjs`. Existing CI discovers the new test automatically. Browser/mobile checks use only the separate synthetic development preview and are not hosted or live-site acceptance.

The host must recompute this display on every accepted projection, at the freshness cutoff, and on visible/page restoration, using the actual current clock. This renderer computes freshness when called; it does not install a timer or fetch loop. A frozen synthetic `options.now` is for tests only. Review of that host lifecycle is an activation prerequisite.

Within one mounted element and exact immutable binding, an unknown/missing/invalid update retains the preceding verified designation as explicitly historical. Older or same-effective contradictory updates cannot clear it. A new record/edition/book/contract clears this transient association. This in-memory guard has no storage and cannot replace the producer's history across reloads; the approved projection must supply `lastVerified` with truthful clocks. Historical Out alone never supplies current provisional VOID or changes exposure/settlement.
