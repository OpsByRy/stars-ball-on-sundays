# Live data lane

Boards, injury/lineup updates and results reach starsballonsundays.com in about a minute
without rebuilding the site. The full build still runs nightly and on every code change.

## How a visitor gets data

```
browser ──/data/*.json──▶ site server (sbos-private-redesign)
                            └─ PUBLISHED_DATA service binding ─▶ sbos-live-data Worker
                                                                   ├─ file in the live layer? → R2 sbos-public-data
                                                                   └─ otherwise              → sbos-public.pages.dev
```

`workers/live-data/worker.mjs` serves a file from R2 only when:

- `LIVE_LAYER` is `on`;
- `current.json` names a layer whose `baseSourceSHA` is the commit Pages is serving (`/_sbos-release.json`);
- the blob's size and R2-stored SHA-256 match the layer descriptor.

Anything else falls back to Pages, the same as before the lane existed.

## How an update gets there

1. The private pipeline (or `results.yml`) commits data to `main`, as before.
2. `live.yml` runs `scripts/build_live.py` against the deploy Pages is serving:
   - **append-only proof** (git diff): only new edition/parlay/SGP/log files and updated indexes, and every index keeps all its old entries unchanged;
   - **per-edition checks** on every edition of each affected date: the same functions the full build runs, plus a daily board's `firstPublishedAt` can't change;
   - **derived views** for those dates, from the full build's own code;
   - every file whose deployed bytes differ from the base deploy.
   Code, pages, profiles, deletions and rewrites are declined (exit 3), and the full build runs instead.
3. `scripts/publish_live.py` uploads the blobs (create-only, with checksums) and the layer, then switches `current.json` by compare-and-swap. Every pointer value is kept in `history/`.
4. It fetches every layer file from starsballonsundays.com and checks its hash. If any check fails, it restores the previous pointer.

After each full deploy, `pages.yml` starts `live.yml` again to rebuild the layer on the new base. The layer is empty if nothing landed meanwhile.

## Switches

| Setting | Effect |
|---|---|
| repo variable `SBOS_LIVE_LANE` unset/`off` | lane does nothing; every push does a full build (as before) |
| `SBOS_LIVE_LANE=shadow` | lane builds and uploads but never moves the pointer; full builds continue on every push |
| `SBOS_LIVE_LANE=on` | lane publishes; data-only pushes skip the full build (nightly 5:17 AM ET + code changes still build) |
| Worker var `LIVE_LAYER=off` | site reads only Pages, whatever the pointer says (instant kill switch) |

Both are `on` in production. `workers/live-data/wrangler.jsonc` records `LIVE_LAYER: "on"`, so a
plain redeploy keeps the lane serving.

**Rollback:** set `LIVE_LAYER=off` on `sbos-live-data` (dashboard, or
`npx wrangler@4 deploy -c workers/live-data/wrangler.jsonc --var LIVE_LAYER:off`) and `SBOS_LIVE_LANE=off`,
then run `Publish SBOS` once.

## Credentials

The lane's only credential is an R2 API token limited to Object Read & Write on bucket
`sbos-public-data`. It is stored as the `SBOS_LIVE_R2_ACCESS_KEY_ID` and
`SBOS_LIVE_R2_SECRET_ACCESS_KEY` repository secrets. That bucket holds only public site data.

## Proof

`python scripts/build_live.py --base-receipt <receipt of deploy A> --out <dir> --prove-against <receipt of the full build of HEAD>`
checks two things for every file:

- every file the full build deployed differently from A is in the layer;
- every layer file is byte-identical to the full build's copy.
