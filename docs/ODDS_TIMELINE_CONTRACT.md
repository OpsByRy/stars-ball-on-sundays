# Inactive saved-price timeline renderer

This draft adds a presentation component and invented test fixtures. No existing
page loads it, no deployment manifest includes it, and it does not fetch, import,
store or publish data. It is not an odds feed or a public-data adapter.

## Activation boundary

A separately reviewed publisher must create a minimal public projection from
accepted evidence, bind it to the exact accepted row and edition, and establish
canonical event/player mapping and all contract terms. The renderer cannot
authenticate that evidence. `accepted_public` is a producer assertion, not a
security boundary or a way to promote unverified source data. Never rename a
private package or change its flag to make it a public projection.

Do not import a private catalogue, shard, receipt, raw provider response, internal
path, private identifier, proof hash or model output into this component. Its
strict nested allowlist rejects extra fields; it does not replace producer-side
privacy review. Public record/event IDs must be opaque public identifiers.

Production activation needs a separate reviewed ticket: authenticated publication
evidence adapters, allowlisted projection and negative tests, exact mapping and
terms, host manifest/page wiring, mobile/browser acceptance and explicit release
authorization. None of these follow from this draft or its passing tests.

## API

CommonJS: `require('./assets/odds-timeline.js')`. Browser: load the existing
`assets/math.js` first, then use `window.SBOS_ODDS_TIMELINE`.

- `buildView(record, context, options)` validates and derives a bounded view.
- `render(record, context, options)` returns escaped HTML.
- `mount(element, record, context, options)` replaces only that component target.
- `VERSION` is `sbos-public-odds-timeline-1`; `MAX_EVENTS` is 512.

Options: `open: true` initially expands history; `now` supplies a numeric test
clock. `allowSynthetic: true` is exclusively for explicit development previews;
synthetic data is otherwise rejected, including the original quote. Enabled
synthetic previews always carry a visible synthetic notice.

`mount` preserves native disclosure state and focused summaries on updates to
the same exact record/contract, including a new edition version. It resets
disclosures for a different record. If a focused control disappears because
history becomes unavailable, focus moves to the component's named section.
It does not start polling or replace surrounding pick/parlay cards.

## Exact allowlist

All keys below are required. Nullable values must be explicit `null`; extra keys
at every level fail closed. Clocks are valid ISO timestamps with seconds and an
explicit UTC offset, never date-only/local clock strings. Unknown clocks remain
null. Prices are numeric American odds with absolute value at least 100; no
numeric strings, nonfinite values or zero placeholders.

Context:

```js
{
  dataKind: 'accepted_public', // or synthetic in an explicit preview
  recordType: 'pick',         // or research
  binding: { /* below */ },
  originalSelection: null,    // or the exact three-key object below
  publication: {kind: 'unknown', at: null}
}
```

Binding (identical in context and history):

```js
{
  recordId: 'opaque-public-record-id',
  editionVersion: 'aaaaaaaaaaaaaaaa', // accepted public version, lowercase hex
  slateDate: '2026-10-31',            // actual New York slate date
  eventId: 'nba:9999999999',          // synthetic example only
  playerId: 'nba:9999999',            // synthetic example only
  book: 'fanduel',                   // or draftkings
  market: 'PTS',                     // AST, REB, 3PM, PRA, PA, PR, RA, BLK, STL
  operator: '>=',                    // >, <, >=, <=; never normalized
  line: 20,                         // raw threshold, finite and nonnegative
  period: 'full_game',
  product: 'sportsbook',
  overtime: true,                    // boolean; null blocks comparison
  settlementRules: 'synthetic-test', // exact accepted identity; null blocks
  jurisdiction: 'synthetic-test',    // exact accepted identity; null blocks
  startTime: '2026-10-31T23:00:00Z'
}
```

No cross-book, cross-period, cross-product, alternate threshold or normalized
`15+`/`>14.5` substitution. Canonical-shaped IDs are not proof of mapping. The
publisher must withhold unverified mappings even if the ID passes syntax checks.

Original selection/quote, when retained in the accepted row:

```js
{americanOdds: -150, capturedAt: '2026-10-31T14:00:00Z', selectedAt: null}
```

Each value is independently nullable. Missing selection evidence is not evidence
that a row was never selected. A known quote cannot follow a known selection
clock. Quote/selection clocks cannot follow the supplied publication/presence
clock. These are original public row facts, not history-derived replacements.

Publication is exactly `{kind, at}`. Kinds:

- `actual_first_row_publication`: accepted evidence of the actual first posting.
- `first_known_deployed_presence`: evidence only that it was online by this time.
- `unknown`: `at` must be null.

A later observation must never fill an original quote or publication-time price.
This v1 renderer does not calculate or display a publication-reference price.

History:

```js
{
  schemaVersion: 'sbos-public-odds-timeline-1',
  dataKind: 'accepted_public',
  status: 'available', // stale, missing, unverified withhold all history metrics
  asOf: '2026-10-31T22:00:00Z',
  binding: { /* exact context binding */ },
  events: [
    {id: 'opaque-event-1', capturedAt: '2026-10-31T13:30:00Z',
     americanOdds: -180, status: 'usable', retractedAt: null}
  ]
}
```

Event statuses: `usable`, `unusable`, `conflicted`, `missing`. Missing coverage
requires null price and retraction. Unusable/conflicted prices may be null or a
valid raw price retained as evidence. Retractions append a correction time; they
do not erase the original observation. Corrections cannot precede observation or
exceed `asOf`. Usable prices must predate the exact game start; this draft is a
pregame-price presentation, not an in-game feed. More than 512 events or duplicate
IDs reject the complete projection; the renderer never silently truncates it.
The producer must explicitly handle larger histories before adopting this v1.

## Consumer semantics

The leading block shows the original SBOS pick price (or saved research quote),
its book and actual quote time, selection time if recorded, and a separately
labeled publication or known-presence clock. History cannot change these facts.

The expandable timeline shows:

- First observation, including an unusable/conflicted/retracted first baseline.
  First retained usable is separately labeled and never replaces that baseline.
- Latest retained valid capture with its actual observation time. A later missing
  check is separate; it does not erase or refresh the last-known quote.
- Payout movement from the original first observation for equal stakes. American
  odds use decimal payout, not subtraction of signed odds. `+100` and `-100` pay
  equally. Higher payout is better; lower payout is lower. One quote has no
  movement comparison.
- Shortest/longest retained valid quotes observed on the New York calendar slate
  day, with their actual timestamps. Earlier observations can remain in history
  without changing this explicitly labeled daily range. Ties use earliest time.
- All retained observations, coverage gaps and correction times in a native table.

Conflicting same-time returned/missing, usable/unusable or different-payout
observations withhold comparison and range. Economically identical aliases retain
their raw observations without creating a conflict. A later clean quote can be
shown, but cannot repair an unusable/conflicted/retracted original baseline.

Unknown, invalid, stale or unverified history produces a bounded unavailable
message. An independently valid original public quote remains visible. `stale`
is an explicit accepted-projection status; the renderer does not invent an
age-only deadline. Historical captures are timestamped, never advertised as live.

First captured is not an opener. Last saved pregame is not an official close.
Captured range is not the market's complete intraday range. A quote before
publication was not guaranteed at posting. No win estimate, settlement, stake,
profit/loss, no-vig, closing-line-value or model result is calculated or changed.

## Verification

Run `node --test tests/odds-timeline.test.cjs`. Fixtures are explicitly invented
and remain outside `site-manifest.json`. The tests also assert that existing
deployable pages do not load these assets. Browser acceptance must exercise real
native disclosures, keyboard focus during same-record refresh, different-record
reset, unavailable fallback, mobile wrapping and theme contrast before activation.
