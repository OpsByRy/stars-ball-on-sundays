"""Build the live data layer: only the public files a data-only commit changes.

The full build (build_hosts.py --publish) re-validates the whole archive and deploys every
file to Cloudflare Pages; the site server reads /data/*.json from there. This fast lane takes
the commit that is live on Pages (its _sbos-release.json receipt) as the base and, for a
later commit that only adds or updates published data:

1. proves nothing already published changed (git diff: no deletions, immutable files only
   added, every mutable index keeps all of its old entries byte-for-byte);
2. runs the full per-edition checks on every edition of each affected date (schema, digest,
   manifest identity and counts, personal-slip and parlay/ticket clock rules, stat targets,
   release window, pending pre-tip markers) and a new one: a daily board's non-null
   firstPublishedAt never changes;
3. rebuilds the derived views for those dates with the same functions the full build uses;
4. writes every file whose deployed bytes differ from the base deploy (same 25 MiB
   compaction/transport as the Pages upload) plus a layer descriptor.

Anything else (site code, pages, profiles, a deleted or rewritten file, an edit that cannot
be dated) is declined (exit 3) and needs the full build. The code is the base's code: any
non-data change since the base declines, and the base passed every test.

This script only reads the repository and writes --out; it uploads nothing.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
from zoneinfo import ZoneInfo

import build
import build_hosts
import json_transport
import plus_money_schema
import sgp_research_schema
from availability_schema import validate_availability
from build import canonical, safe_file
from edition_validation import read_edition
from matchup_schema import validate_matchups
from pending_additions import verify_pending_additions
from pending_parlays import verify_pending_parlays
from public_schema import validate_edition, validate_manifest, validate_targets

SCHEMA = 'sbos-live-layer-1'
BASE_ORIGIN = 'https://sbos-public.pages.dev'
DATE = r'\d{4}-\d{2}-\d{2}'
# Immutable bodies: may only be added.
ADD_ONLY = re.compile(rf'data/editions/(?:daily|sunday)/{DATE}/[0-9a-f]{{16}}\.json|data/plus-money/{DATE}/[0-9a-f]{{16}}\.json'
                      rf'|data/sgp-research/{DATE}/[0-9a-f]{{16}}\.json|data/player-logs/\d{{4}}-\d{{2}}/\d{{1,12}}/[0-9a-f]{{16}}\.json')
# Indexes and logs the publisher and results jobs update in place.
MUTABLE = {
    'data/editions/manifest.json', 'data/plus-money/manifest.json', 'data/sgp-research/manifest.json',
    'data/stat-targets.json', 'data/matchups.json', 'data/player-availability.json',
    'data/published-selection-results.json', 'data/pick-withdrawal-reasons.json',
    'data/parlay-withdrawal-reasons.json', 'assets/parlay-withdrawals.json',
    'data/player-logs/catalog.json', 'data/player-logs/index.json',
}
SEASON_INDEX = re.compile(r'data/player-logs/\d{4}-\d{2}/index\.json')
# Root markers the publisher writes; never served, verified exactly as the full build does.
MARKERS = {'publication-window.json', 'pending-additions.json', 'pending-parlays.json'}
# Served by the site server's published-data proxy (dataPath() in the redesign server).
HEADERS = {'User-Agent': 'sbos-live-lane/1', 'Cache-Control': 'no-cache'}
SERVED = re.compile(r'(?:data/[A-Za-z0-9_/-]+\.json|assets/parlay-withdrawals\.json)')


class Decline(Exception):
    """Not a data-only change this lane can prove; the full build must publish it."""


def git(root, *args, binary=False):
    out = subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)
    return out.stdout if binary else out.stdout.decode()


def at(root, sha, name):
    """A file's bytes at a commit, or None if it did not exist there."""
    try:
        return git(root, 'show', f'{sha}:{name}', binary=True)
    except subprocess.CalledProcessError:
        return None


def materialize(root, names):
    """Write HEAD's bytes for files a sparse checkout left out (the 10 GB edition archive)."""
    for name in names:
        path = root / name
        if path.is_file():
            continue
        raw = at(root, 'HEAD', name)
        if raw is None:
            raise ValueError(f'Missing public file: {name}')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)


def load_receipt(source):
    if source.startswith('https://'):
        with urllib.request.urlopen(urllib.request.Request(source, headers=HEADERS), timeout=60) as r:
            raw = r.read()
    else:
        raw = Path(source).read_bytes()
    receipt = json.loads(raw)
    if receipt.get('schemaVersion') != 'sbos-public-release-1' or not re.fullmatch('[0-9a-f]{40}', receipt.get('sourceSHA', '')):
        raise ValueError('Invalid base release receipt')
    return receipt


def base_file(origin, receipt, name):
    """A small derived file exactly as deployed at the base (its hash must match the receipt)."""
    expected = receipt['files'].get('/' + name)
    if expected is None:
        return None
    with urllib.request.urlopen(urllib.request.Request(f'{origin}/{name}', headers=HEADERS), timeout=60) as r:
        raw = r.read()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise Decline(f'Base {name} on {origin} differs from the base receipt (a newer deploy landed?)')
    return raw


def deployed_bytes(name, raw):
    """(bytes the Pages upload would carry, bytes a visitor receives) — build_hosts.assemble's
    25 MiB handling; the site server decodes the gzip-base64 transport, not the compaction."""
    if len(raw) <= build_hosts.PAGES_MAX_BYTES:
        return raw, raw
    try:
        compact = build_hosts.pages_asset(name, raw, build_hosts.PAGES_MAX_BYTES)
        return compact, compact
    except ValueError:
        if not build_hosts.IMMUTABLE_EDITION.fullmatch(name):
            raise
        encoded = json_transport.encode(raw)
        if len(encoded) > build_hosts.PAGES_MAX_BYTES:
            raise ValueError('Pages file exceeds 25 MiB: ' + name)
        return encoded, raw


def entries_by_path(index):
    return {e['path']: e for e in index['editions']}


def require_kept(name, old, new, items):
    """Every entry the base had is still there, unchanged and in the same order."""
    before, after = items(old), items(new)
    keyed = [canonical(x) for x in after]
    kept = [canonical(x) for x in before]
    position = 0
    for item in kept:
        try:
            position = keyed.index(item, position) + 1
        except ValueError:
            raise Decline(f'{name}: an already published entry was changed or removed') from None
    return [x for x in after if canonical(x) not in set(kept)]


def changed_paths(root, base, head):
    added, modified = [], []
    for line in git(root, 'diff', '--no-renames', '--name-status', base, head).splitlines():
        status, name = line.split('\t', 1)
        if status == 'A':
            added.append(name)
        elif status == 'M':
            modified.append(name)
        else:
            raise Decline(f'{name}: {status} (only additions and index updates go through the live lane)')
    for name in added + modified:
        if build_hosts.PRIVATE_PATH.search(name):
            raise Decline(f'{name}: private or unsafe path')
        if ADD_ONLY.fullmatch(name):
            if name in modified:
                raise Decline(f'{name}: an immutable published file changed')
        elif name not in MUTABLE and name not in MARKERS and not SEASON_INDEX.fullmatch(name):
            raise Decline(f'{name}: not a published-data file (needs the full build)')
    return added, modified


def build_layer(root, receipt, *, origin=BASE_ORIGIN, now=None, base_files=None):
    """Returns (descriptor, {name: deployed bytes}). Raises Decline or ValueError."""
    root = Path(root).resolve()
    now = now or datetime.now(timezone.utc)
    base, head = receipt['sourceSHA'], git(root, 'rev-parse', 'HEAD').strip()
    try:
        git(root, 'merge-base', '--is-ancestor', base, head)
    except subprocess.CalledProcessError:
        raise Decline('The live deploy is not an ancestor of this commit') from None
    added, modified = changed_paths(root, base, head)
    changed = set(added) | set(modified)
    checks = []
    fetch_base = base_files or (lambda name: base_file(origin, receipt, name))

    def old_json(name, empty):
        raw = at(root, base, name)
        return json.loads(raw) if raw is not None else empty

    def new_json(name, empty):
        return json.loads(safe_file(root, name).read_text()) if (root / name).exists() else empty

    # 1. Append-only proof for every index and log that changed.
    days = set()
    manifest = new_json('data/editions/manifest.json', None)
    validate_manifest(manifest)
    old_manifest = old_json('data/editions/manifest.json', {'editions': []})
    new_entries = require_kept('editions manifest', old_manifest, manifest, lambda b: b['editions'])
    for entry in new_entries:
        if 'data/editions/' + entry['path'] not in added:
            raise Decline('A new manifest entry does not point at a newly added edition')
        days.add(entry['date'])
    if {n for n in added if n.startswith('data/editions/') and n != 'data/editions/manifest.json'} != {'data/editions/' + e['path'] for e in new_entries}:
        raise Decline('Added edition files and new manifest entries differ')
    for folder in ('plus-money', 'sgp-research'):
        name = f'data/{folder}/manifest.json'
        if name in changed:
            fresh = require_kept(f'{folder} manifest', old_json(name, {'editions': []}), new_json(name, None), lambda b: b['editions'])
            if {n for n in added if n.startswith(f'data/{folder}/') and n != name} != {f'data/{folder}/' + e['path'] for e in fresh}:
                raise Decline(f'Added {folder} files and new manifest entries differ')
            days.update(e['date'] for e in fresh)
    if 'data/stat-targets.json' in changed:
        new_targets = require_kept('stat targets', old_json('data/stat-targets.json', {'targets': []}), new_json('data/stat-targets.json', None), lambda b: b['targets'])
    else:
        new_targets = []
    for name, field in (('data/pick-withdrawal-reasons.json', 'reasons'), ('data/parlay-withdrawal-reasons.json', 'reasons'),
                        ('assets/parlay-withdrawals.json', 'withdrawals')):
        if name in changed:
            days.update(x['date'] for x in require_kept(name, old_json(name, {field: []}), new_json(name, None), lambda b: b[field]))
    if 'data/published-selection-results.json' in changed:
        old_results = old_json('data/published-selection-results.json', {'results': {}})['results']
        for key, value in new_json('data/published-selection-results.json', None)['results'].items():
            if old_results.get(key) != value:
                contract = json.loads(key)
                if not isinstance(contract, list) or not re.fullmatch(DATE, str(contract[0])):
                    raise Decline('A saved result cannot be dated')
                days.add(contract[0])
        if set(old_results) - set(new_json('data/published-selection-results.json', None)['results']):
            raise Decline('A saved result was removed')
    checks.append(f'append-only proof: {len(added)} added, {len(modified)} updated since {base[:12]}')

    # Every edition of an affected date is read and fully checked, in manifest order.
    dated = [e for e in manifest['editions'] if e['date'] in days]
    marker_days = set()
    for marker in ('pending-additions.json', 'publication-window.json'):
        if (root / marker).exists():
            marker_days.add(json.loads((root / marker).read_text())['date'])
    materialize(root, ['data/editions/' + e['path'] for e in manifest['editions'] if e['date'] in days | marker_days])
    newest = sorted((e for e in manifest['editions'] if e['channel'] == 'daily'), key=lambda e: (e['date'], e['updatedAt']), reverse=True)[:3]
    materialize(root, ['data/editions/' + e['path'] for e in newest])

    # 2. Per-edition checks (build.publication_files, restricted to the affected dates).
    fresh_paths = {e['path'] for e in new_entries}
    source_hashes, published, personal_state, first_clock, bodies = {}, set(), {}, {}, {}
    for entry in dated:
        name = 'data/editions/' + entry['path']
        checked = read_edition(root, name, safe_file=safe_file, validate=validate_edition, canonical=canonical)
        source_hashes[name] = checked.byte_sha256
        build.preserve_personal_slips(checked.personal_body(), personal_state)
        if (checked.channel, checked.date, checked.version) != (entry['channel'], entry['date'], entry['version']):
            raise ValueError('Edition identity mismatch')
        if checked.count != entry['count'] or checked.research_count != entry['researchCount']:
            raise ValueError('Edition count mismatch')
        published.update(checked.targets)
        first = json.loads(safe_file(root, name).read_text()).get('firstPublishedAt') if entry['channel'] == 'daily' else None
        key = (entry['channel'], entry['date'])
        if first is not None:
            if key in first_clock and first_clock[key] != first and entry['path'] in fresh_paths:
                raise ValueError('A daily board first-publication clock cannot change')
            first_clock.setdefault(key, first)
        if entry['path'] in fresh_paths:
            bodies[entry['path']] = checked
    targets = new_json('data/stat-targets.json', None)
    validate_targets(targets)
    for t in new_targets:
        if (t['date'], t['eventId'], t['playerId']) not in published:
            raise ValueError('Unpublished candidate identity in public targets')
    if 'data/plus-money/manifest.json' in changed:
        plus_money_schema.publication_files(root, safe_file)
    if 'data/sgp-research/manifest.json' in changed:
        fresh = {n[len('data/sgp-research/'):] for n in added if n.startswith('data/sgp-research/') and n != 'data/sgp-research/manifest.json'}
        materialize(root, ['data/editions/' + json.loads((root / 'data/sgp-research' / p).read_text())['sourceDaily']['path'] for p in fresh])
        sgp_research_schema.publication_files(root, safe_file, only=fresh)
    if any(n.startswith('data/player-logs/') for n in changed):
        build.game_log_files(root)
    if 'data/matchups.json' in changed:
        validate_matchups(new_json('data/matchups.json', None))
    if 'data/player-availability.json' in changed:
        validate_availability(new_json('data/player-availability.json', None))
    build.assert_publication_time(new_entries, now)
    today = now.astimezone(ZoneInfo('America/New_York')).date().isoformat()
    current = [e for e in manifest['editions'] if e['channel'] == 'daily' and e['date'] == today]
    if current and today in days:
        build.assert_personal_estimates(json.loads((root / 'data/editions' / current[-1]['path']).read_text()))
    checks.append(build_hosts.publication_window(root, now))
    checks.append(verify_pending_additions(root, now))
    checks.append(verify_pending_parlays(root, now))
    checks.append(f'per-edition checks: {len(dated)} editions on {len(days)} dates ({len(new_entries)} new)')

    # 3. Derived views for the affected dates, with the full build's own code.
    views = {}
    if days:
        views.update(build.board_views(root, only={('daily', d) for d in days}))
        views.update(published_views(root, source_hashes, days))
    if new_entries:
        views.update(build.identity_view(root))
        base_prices = fetch_base('data/personal-tracking-prices.json')
        if base_prices is None:
            raise Decline('Base deploy has no personal tracking prices')
        old_entries = old_manifest['editions']
        if old_entries and min(e['updatedAt'] for e in new_entries) <= max(e['updatedAt'] for e in old_entries):
            raise Decline('A new edition sorts before an already published one (personal prices need the full build)')
        saved = {(t['ticketId'], tuple(t['legIds'])): t for t in json.loads(base_prices)['tickets']}
        for entry in sorted(new_entries, key=lambda e: e['updatedAt']):
            build.add_personal_prices(saved, entry, bodies[entry['path']].personal_body())
        views['data/personal-tracking-prices.json'] = {'schemaVersion': 'public-personal-tracking-prices-1', 'tickets': list(saved.values())}
    if 'data/matchups.json' in changed:
        views.update(build.portrait_view(root))

    # 4. Everything that differs from the base deploy.
    # A changed existing file the base deploy doesn't serve is a build input only (e.g.
    # data/pick-withdrawal-reasons.json feeds the published views); the full build never deploys it.
    inputs_only = sorted(n for n in changed - MARKERS if n in modified and '/' + n not in receipt['files'])
    if inputs_only:
        checks.append('build inputs not deployed by the full build, left out: ' + ', '.join(inputs_only))
    candidates = {n: safe_file(root, n).read_bytes() for n in sorted(changed - MARKERS - set(inputs_only))}
    for name, view in views.items():
        if name in candidates:
            raise ValueError('A derived view would overwrite a source file: ' + name)
        candidates[name] = canonical(view)
    files, served = {}, {}
    for name, raw in sorted(candidates.items()):
        if not SERVED.fullmatch(name):
            raise Decline(f'{name}: not served by the site data proxy')
        data, visible = deployed_bytes(name, raw)
        digest = hashlib.sha256(data).hexdigest()
        if receipt['files'].get('/' + name) != digest:
            files[name] = data
            if visible is not data:
                served[name] = hashlib.sha256(visible).hexdigest()
    descriptor = {
        'schemaVersion': SCHEMA, 'sourceSHA': head, 'baseSourceSHA': base,
        'baseEditionManifestSHA256': receipt['editionManifestSHA256'],
        'dates': sorted(days), 'checks': checks,
        'files': {'/' + n: {'sha256': hashlib.sha256(d).hexdigest(), 'bytes': len(d), **({'servedSHA256': served[n]} if n in served else {})}
                  for n, d in files.items()},
    }
    descriptor['layerId'] = hashlib.sha256(canonical(descriptor)).hexdigest()
    descriptor['builtAt'] = now.isoformat()
    return descriptor, files


def published_views(root, source_hashes, days):
    command = ['node', str(root / 'scripts/published-picks.cjs'), str(root), '--verified-source-hashes', '--days', ','.join(sorted(days))]
    try:
        out = subprocess.run(command, input=json.dumps(source_hashes), check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        raise ValueError('Published history validation failed:\n' + (error.stderr.strip()[-12000:] or str(error))) from error
    return json.loads(out.stdout)


def write_layer(out, descriptor, files):
    out = Path(out)
    (out / 'blobs').mkdir(parents=True, exist_ok=True)
    for data in files.values():
        (out / 'blobs' / hashlib.sha256(data).hexdigest()).write_bytes(data)
    (out / 'layer.json').write_text(json.dumps(descriptor, sort_keys=True, indent=1) + '\n')


def prove(descriptor, files, base_receipt, head_receipt):
    """Compare a layer with the full build of the same commit: every file the full build
    deployed differently from the base must be in the layer, with the same bytes."""
    ignore = {'/_sbos-release.json'}
    expected = {p: h for p, h in head_receipt['files'].items() if p not in ignore and base_receipt['files'].get(p) != h}
    layer = {p: v['sha256'] for p, v in descriptor['files'].items()}
    missing = sorted(p for p in expected if p not in layer)
    wrong = sorted(p for p in layer if head_receipt['files'].get(p) != layer[p])
    removed = sorted(p for p in base_receipt['files'] if p not in head_receipt['files'] and p not in ignore)
    return {'fullBuildChanged': len(expected), 'layerFiles': len(layer), 'missingFromLayer': missing,
            'differentFromFullBuild': wrong, 'removedByFullBuild': removed,
            'identical': not (missing or wrong or removed)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base-receipt', default=BASE_ORIGIN + '/_sbos-release.json', help='The live deploy receipt (URL or file)')
    parser.add_argument('--base-origin', default=BASE_ORIGIN, help='Where the base deploy serves its files')
    parser.add_argument('--out', required=True)
    parser.add_argument('--prove-against', help='Receipt of the full build of this same commit (shadow proof)')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    receipt = load_receipt(args.base_receipt)
    try:
        descriptor, files = build_layer(root, receipt, origin=args.base_origin)
    except Decline as declined:
        print(json.dumps({'status': 'declined', 'reason': str(declined), 'baseSourceSHA': receipt['sourceSHA']}))
        return 3
    write_layer(args.out, descriptor, files)
    summary = {'status': 'built', 'layerId': descriptor['layerId'], 'sourceSHA': descriptor['sourceSHA'],
               'baseSourceSHA': descriptor['baseSourceSHA'], 'dates': descriptor['dates'], 'files': len(files),
               'bytes': sum(len(d) for d in files.values()), 'checks': descriptor['checks']}
    if args.prove_against:
        summary['proof'] = prove(descriptor, files, receipt, load_receipt(args.prove_against))
    print(json.dumps(summary, indent=1))
    return 0 if summary.get('proof', {}).get('identical', True) else 4


if __name__ == '__main__':
    sys.exit(main())
