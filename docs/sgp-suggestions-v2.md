# Inactive public SGP suggestions v2

`assets/sgp-suggestions.js` is a standalone, offline consumer for
`public-sgp-ideas-2`. It exports `SBOSSgpSuggestions` in a browser and a CommonJS
API in Node. It performs no fetching, collection, storage, qualification, or
automatic rendering. It has no private engine dependency.

This increment does not adopt a dataset. The active PR34 v1 reader, route, loader,
empty `assets/sgp-ideas.json`, publication manifest, hosting, and authentication
are unchanged. The v2 asset is intentionally absent from the publication
allowlist. Connecting it to an active page or publishing v2 data requires a
separate reviewed change.

## API

- `validate(body, now = Date.now())` rejects the whole input on any contract
  violation and returns the original object without mutation. `now` is an exact,
  safe integer number of milliseconds since the Unix epoch.
- `summary(body, now)` validates first and returns the existing v1 statistical
  tracking counts and descriptive hit rate. Only wins and losses enter that
  denominator; pending, push, DNP, and unknown results remain separate.
- `render(body, document, container, now)` validates before replacing the
  container, uses text nodes, preserves idea/leg order, and shows coverage,
  estimates, historical summaries, observation times, holds, and statistical
  tracking. It does not sort or filter by compatibility.
- `resultFor(idea, resolutions)`, `american(value)`, and `et(timestamp)` are
  display helpers. `resultFor` assumes validated inputs. `et` formats ET display
  times; validation never compares those rounded display strings.

The caller supplies already-parsed data. There is no v2 network loader in this
increment. The focused fixtures are fictional and remain inside the test file.

## Exact public shape

Objects must have exactly the fields below and a plain object prototype. Arrays
must be dense and have no extra fields. Extra fields, including private audit
rows, original selections, exposure, models, features, history, weights, source
paths/hashes/receipts, and arbitrary reason text, fail validation at every level.

| Object | Exact fields |
| --- | --- |
| Root | `schemaVersion`, `ideas`, `resolutions`, `coverage` |
| Coverage | `availableIdeas`, `displayedIdeas`, `omittedIdeas`, `searchComplete` |
| Idea | `id`, `kind`, `date`, `book`, `bookEventId`, `eventLabel`, `nativeEventId`, `officialStart`, `legs`, `observed`, `combinedPrice`, `estimatedCombinedPrice`, `holds`, `jointWinProbability`, `ticketEV`, `betReady`, `algorithmQualified`, `compatibility` |
| Leg | `player`, `nativePlayerId`, `nativeTeamId`, `market`, `operator`, `side`, `threshold`, `americanOdds`, `period`, `overtime`, `settlementTermsState` |
| Observation | `captureId`, `startedAt`, `completedAt`, `bookUpdatedAt` |
| Actual combined price | `kind`, `americanOdds` |
| Estimated combined price | `kind`, `americanOdds`, `decimalOdds`, `method`, `sportsbookVerified` |
| Compatibility | `state`, `metric`, `value`, `units`, `evidenceGames`, `interval95`, `vintageMode`, `selectionUse`, `validated` |
| Resolution | `ideaId`, `sourceRef`, `nativeEventId`, `finalAt`, `observedAt`, `identityVerified`, `eventState`, `finalityVerified`, `resultBasis`, `legResults` |

`schemaVersion` is exactly `public-sgp-ideas-2`. There are at most 64 ideas and 64
resolutions. Coverage counts are integers: available/omitted 0–256 and displayed
0–64. Displayed equals `ideas.length`, available equals displayed plus omitted,
and `searchComplete` is a boolean. These counts describe the supplied retained
candidate pool: omitted counts public-display-cap omissions within that pool,
not candidates absent from it. The paired producer marks search incomplete if
either the visit census is incomplete or candidate-retention omissions exist.
The renderer labels supplied-pool coverage and warns that additional combinations
may be absent when incomplete. It does not claim full-slate completeness.
Coverage and display follow fixed input contract order, with no compatibility
ranking.

For example, an empty v2 input is:

```json
{"schemaVersion":"public-sgp-ideas-2","ideas":[],"resolutions":[],"coverage":{"availableIdeas":0,"displayedIdeas":0,"omittedIdeas":0,"searchComplete":false}}
```

## Identity, counting contracts, scope, and holds

Idea IDs, capture IDs, and resolution source references are primitive opaque
strings matching `[a-zA-Z0-9_-]{1,100}`. `kind` is `research_idea`. Books are
`FanDuel` or `DraftKings`. `bookEventId` is a primitive string of 1–24 ASCII
digits; leading zeros and integers beyond JavaScript's exact numeric range stay
literal. Provider UUIDs and coerced numeric identities are rejected. Native
events match `nba:` plus exactly ten digits; native players/teams match `nba:`
plus digits. Display names never originate from interpreting these IDs.

Each idea has two to six legs under its one book/event and a common `full_game`
scope with matching overtime states. Markets are `PTS`, `REB`, `AST`, `3PM`,
`PRA`, `PR`, `PA`, or `RA`. Operators are `>`, `>=`, `<`, or `<=`; side must agree
with the operator. Thresholds are finite numbers from 0 to 1000. Counting `< 0`
is impossible and rejects. Saved American leg odds are integers with absolute
value 100–1,000,000. Overtime is explicitly `true`, `false`, or `null`, and terms
are `verified` or `unverified`.

For the same normalized player name or exact native ID, duplicate statistics,
combo/component overlap, and points-containing markets combined with `3PM`
reject regardless of side or threshold. Conflicting native player/team IDs also
reject. Names normalize using NFKC, collapsed whitespace, and lowercase for
these checks. Disjoint same-player counting statistics are allowed.

Every idea requires `quote_not_execution`, `joint_probability_unavailable`, and
`current_role_availability_unverified`. Nullable native identity, official start,
or unknown overtime/terms retain PR34's required `native_identity_unverified`,
`official_start_unverified`, and `terms_jurisdiction_unverified` respectively.
Those six strings are the entire hold allowlist; duplicates reject. A producer
may choose the stricter subset with complete identities, start, and known terms.

`jointWinProbability` and `ticketEV` must be null. `betReady` and
`algorithmQualified` must be false. There are no stakes, betting units, profit,
or loss amounts in this contract.

## Separate actual and estimated prices

`combinedPrice` retains its v1 meaning: either
`observed_sportsbook_quote` with integer American odds of absolute value
100–1,000,000, or `unavailable` with null odds. A derived product cannot populate
this field. The paired producer in this increment emits unavailable actual
combined prices.

`estimatedCombinedPrice.method` is always
`product_of_saved_decimal_leg_prices_no_sgp_adjustment`, and
`sportsbookVerified` is always false. An available estimate uses kind
`estimated_saved_leg_price_product`, safe integer American odds with absolute
value at least 100, and a finite decimal string greater than one with at most
18 significant digits. Decimal exponent notation is allowed; whitespace and
nondecimal notation reject.

The consumer independently multiplies the saved leg-price fractions with BigInt:
positive American `a` becomes `(100 + a) / 100`, and negative `a` becomes
`(100 + abs(a)) / abs(a)`. It converts that exact product to American odds and
rounds halfway away from zero. The supplied American estimate must match exactly.
The supplied decimal string must agree with the product within relative
`1e-15`, accommodating 18-significant-digit decimal display. If the rounded
American value exceeds `Number.MAX_SAFE_INTEGER` in absolute value, the kind
must instead be `unavailable_display_range` and both numeric fields must be
null. That unavailable state is rejected for products that can be displayed.

Both available and unavailable estimates keep the label
**Estimated combined price · saved straight-price product** and explain that
this is not a sportsbook quote, fair price, EV, or probability. No SGP dependence
or sportsbook repricing is modeled. Standard price arithmetic does not establish
that a sportsbook accepts the combination.

## Descriptive historical compatibility

The only public historical metric is `historical_all_win_excess_pp`, in
`percentage_points`. It always has `selectionUse: informational_only` and
`validated: false`. It does not control inclusion, ordering, qualification, or
value claims, and it does not supply a probability.

- `unavailable` requires null value/interval/vintage and zero evidence games.
- `descriptive_only` requires a finite signed value in [-100, 100], 1–256
  evidence games, and explicit `strict_asof` or `retrospective_revised` vintage.
- `interval95` is null or a two-number ordered interval in [-100, 100]. A
  non-null interval requires at least ten evidence games.

The renderer shows the signed value, evidence count, vintage, and interval (or
its unavailability). Revised data is plainly labeled **Retrospective revised
history**. There are no high/medium/low score bands.

## Exact clocks and statistical finality

Clocks must be actual UTC ISO calendar timestamps in
`YYYY-MM-DDTHH:mm:ss[.1..6digits]Z` form. Offsets, ambiguous local clocks,
impossible dates, and extra fractional precision reject. Chronology uses BigInt
microseconds, including submillisecond provider/capture/start/final clocks;
timestamps remain unmodified. `Date` is used for calendar validity and display,
with ET determining the official start's slate date.

Acquisition start is at or before completion, completion is nonfuture, any
provider update is at or before acquisition start, and completion is strictly
before a known official start. Original bound capture times must be preserved
by the producer; this reader cannot prove source provenance from public IDs.

Resolutions retain PR34's exact field shape and must refer to a unique existing
idea with verified matching native event/player/team identities and a known
official start. They require `identityVerified: true`, `eventState: final`,
`finalityVerified: true`, and
`resultBasis: statistical_only_not_book_settlement`. Official start must be
strictly before final time, final time at or before observation, and observation
nonfuture. There is one result per leg, from `win`, `loss`, `push`, `dnp`, or
`unknown`. These are statistical outcomes and do not assert sportsbook settlement.

## Validation

Run `node --test tests/sgp-suggestions.test.cjs` for fixture-only v2 contract,
arithmetic, privacy, chronology, tracking, order, and text-rendering tests. Run
the existing repository checks before review:

```sh
python3 -m unittest discover -s tests
node --test tests/*.test.cjs
python3 scripts/build.py
python3 scripts/build_hosts.py
```

No live collection, active integration, deployment, authentication change, or
private source import is part of this increment.
