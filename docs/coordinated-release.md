# Coordinated release review

This is a draft source-side gate. It grants no deployment authority. Its companion
private review compiler and direct publisher adapters require separate adoption.
The private compiler must verify changed provider event, athlete and team identity
against accepted mapping evidence before certifying it; this companion check is
still outstanding.
The active private export hold remains in force; no new selection review or release
has been authorized or prepared by this change.

`python scripts/build_hosts.py --publish` checks the actual staged selection
revision independently of the optional pending markers. The anchor accepts the
previously verified production source `ea2f4ddc2aac61bf87cf47e04a6ad346facc836c`:
62 single-pick editions and 26 parlay editions. It records public identifiers and
digests, with no private model, source paths, credentials or research evidence.
It is excluded from consumer assets by the existing explicit build allowlist.

Results may append immutable editions without a new selection review when all
contracts, odds, estimates, source identities, selection/review/posting clocks,
ticket memberships and other non-result fields are unchanged. Numeric values
remain semantically identical after a Node JSON round trip (`1.0` becomes `1`),
while every accepted immutable file retains its original byte hash. Unknown
selection fields remain bound. Ordinary saved-quote age is not a publication
deadline; actual quote and forecast timestamps are retained.

New selections require a sanitized, exact-revision review receipt. Before-tip
review alone cannot certify first publication after tip. Later result updates for
such a revision require a separately reviewed publication observation. Posting
clock amendments are bound as control changes, rather than automatically accepted
as result updates. An after-tip clock repair needs a separately reviewed adapter;
this draft conservatively rejects unsupported amendments.

Before direct upload, run:

```sh
python scripts/coordinated_release.py --root "$PWD" --artifact "$PWD/dist-cloudflare"
```

The artifact check requires clean committed source, validates the selection JSON
against that source, and independently rebuilds the entire hosting output into a
temporary directory. It compares every page, script, derived view, generated header
and asset, plus the complete receipt. Rewriting an asset and its local hash receipt
cannot substitute for a build from the committed source. Existing build outputs
are preserved. The full reconstruction adds local validation time; the gate
rechecks source cleanliness, target identity and tip boundaries afterward.

The anchor, sanitized review and publication observation are protected-review trust
inputs, not signed proof that a private review or remote deployment occurred.
Maintainers who can replace the validator can replace its policy. Branch review,
the single publisher, authentic deployment evidence and explicit release authority
remain required. This code cannot intercept unrelated account API calls.

Adoption remains blocked on matching private compiler integration and review of
all direct uploader routes. In particular, uploaders must bind the actual request
bytes to those checked by the gate, including changes during asynchronous network
requests. No uploader, hosting configuration or deployment is changed by this PR.
