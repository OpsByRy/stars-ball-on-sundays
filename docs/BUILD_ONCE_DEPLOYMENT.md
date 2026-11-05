# Build once, deploy the validated artifact

`Publish SBOS` runs the Python and Node suites, then runs
`python scripts/build_hosts.py --publish` once. It seals both host outputs with
an exact path/size/SHA256 inventory. This includes hidden files, `_headers`,
`_sbos-release.json`, all immutable history, and the GitHub handoff pages.
The build job exports the manifest digest and exact resolved source SHA through
trusted job outputs. Deployment jobs download the same run/attempt artifact and
verify every file against those outputs. Neither deployment job builds the site.
No data collection, model selection, private export, or access-policy change is
part of this workflow.

The existing result-workflow source resolver remains in place: its actual final
commit, rather than the workflow's original SHA, identifies the artifact.
Production uploads reject a source that is no longer main and reject a Cloudflare
project that still has automatic Git production builds enabled. All publishing
runs share the existing `sbos-pages` concurrency group without cancellation.

## Rollout state and prerequisites

Direct upload is OFF unless repository variable `SBOS_ARTIFACT_DEPLOY` is exactly
`enabled`. With the variable absent, the existing Cloudflare Git integration
continues publishing and the existing hosted verification gate controls GitHub.
The artifact is still sealed and retained for 30 days.

Required credential: repository secret `SBOS_CLOUDFLARE_PAGES_TOKEN`, scoped to
Cloudflare Pages Edit on account `fbdf495767bb144edfcbb7f1609e2629` only. Creating
or installing it requires the owner's separate credential approval. Never put
its value into a handoff, source, logs, or chat. Existing Cloudflare access and
custom-domain settings must remain unchanged.

## Proof before cutover

1. Pin a source commit and saved public data. Run full tests. Run the original
   `build_hosts.py --publish` and seal its outputs outside the checkout.
2. Build the candidate on those identical inputs. Seal it separately. Run:
   `python scripts/release_artifact.py compare OLD_ARTIFACT NEW_ARTIFACT`.
   This requires identical complete host trees, without timestamp or HTML
   normalization. This second build is a migration experiment, not a normal
   production publishing step.
3. Create the scoped credential only after approval. Dispatch `Publish SBOS`
   with `preview_artifact=true`. It uploads to the existing project's
   `artifact-preview` branch, never main, and never updates GitHub Pages.
   Preview URLs serve the same already-public site content. No private content
   or access configuration is added. Verify the returned immutable URL against
   the locally sealed release receipt and the existing page/history checks.
4. Record successful run ID, source SHA, manifest SHA256, preview deployment ID,
   URL, and checks. Test routing, headers, old links, and domain redirect behavior.
   Do not claim a local comparison establishes hosted preview success.
5. Coordinate the quiet cutover with the existing single publishing owner.
   Check for a newer source or in-flight deployment. Keep an exact current
   Cloudflare configuration snapshot and latest successful deployment ID.
6. Only after proof, disable `source.config.production_deployments_enabled` on
   existing `sbos-public`; leave source linkage, main branch, custom domain,
   preview policy, and access controls intact. Set `SBOS_ARTIFACT_DEPLOY=enabled`.
   Dispatch the current main release. The workflow verifies Cloudflare before
   publishing the existing GitHub redirect artifact.
7. Record live source, deployment ID, real completion time, release marker,
   route/history checks, and GitHub handoff result. A successful upload alone
   is not sufficient proof.

## Rollback

For a delivery-path failure, unset `SBOS_ARTIFACT_DEPLOY`, restore Cloudflare's
saved automatic Git production-build setting and original command:

```
python3 -m unittest discover -s tests && node --test tests/*.test.cjs && python3 scripts/build_hosts.py --publish
```

Keep destination `dist-cloudflare`, root `/`, existing project, domain, and GitHub
handoff policy. Trigger the latest reviewed main commit through the restored
path. Do not reset main or restore stale data/history to repair delivery.
Cloudflare's retained deployment rollback is available for an emergency only
after checking whether it would remove later published editions or results.
A previously downloaded artifact can be reverified with its recorded trusted
manifest digest; do not derive trust from a replacement artifact's own manifest.

## Local commands

```
python scripts/release_artifact.py seal --source . --output /tmp/release-artifact --source-sha FULL_COMMIT_SHA
python scripts/release_artifact.py verify --artifact /tmp/release-artifact --source-sha FULL_COMMIT_SHA --manifest-sha RECORDED_MANIFEST_SHA256
```

Sealing refuses an existing destination. Verification rejects extra, missing,
changed, symlinked, and special files. Hashes provide integrity and source
binding; they are not an independent signature. Trust comes from the exact
successful workflow run and its build outputs.

The deployment action and Wrangler version are pinned. No framework build,
Worker code, functions, DNS migration, or credential rotation is performed.

References:
- https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
