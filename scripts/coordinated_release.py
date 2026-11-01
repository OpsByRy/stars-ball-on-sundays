"""Public-safe coordinated-release gate. No engine, credentials or network.

The checked-in anchor and attestations are reviewer-controlled trust inputs, not
cryptographic proof of a private review. A repository maintainer can replace this
code; protected-branch review and the single publisher remain required.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

SCHEMA = 'sbos-coordinated-release-1'
ANCHOR_SHA256 = '51dbf63bcf1eef079fde7ac5c6b93b54a6bb8c8783ed627ea34342c1954c21e5'
ANCHOR_PATH = 'release-control/anchor.json'
RECEIPT_PATH = 'release-control/review.json'
CONFIRMATION_PATH = 'release-control/publication.json'
EVIDENCE_ROLES = {'research', 'parlay', 'same_game', 'daily_handoff', 'controls', 'membership', 'exposure', 'producer'}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def numeric_values(value):
    # JSON.stringify turns 1.0 into 1 during result refresh. Bind numeric
    # values consistently without changing any immutable source bytes.
    if isinstance(value, float) and value.is_integer(): return int(value)
    if isinstance(value, dict): return {k: numeric_values(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [numeric_values(v) for v in value]
    return value


def digest(value): return hashlib.sha256(canonical(numeric_values(value))).hexdigest()


def file_sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def stamp(value):
    time = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if time.utcoffset() is None: raise ValueError('Explicit timezone required')
    return time.astimezone(timezone.utc)


def safe(root, name):
    root = Path(root).absolute(); path = root / name
    if Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name:
        raise ValueError('Unsafe release-control path')
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
        raise ValueError('Missing or linked release-control file: ' + str(name))
    return path


def read(root, name): return json.loads(safe(root, name).read_text())


def row_semantic(row):
    # Result refresh and publication confirmation must retain real quote/model
    # clocks. In particular capturedAt, estimate.asOf and confidenceUpdate stay.
    # resultSource identifies the event, athlete, team and provider; it is
    # selection identity, not a mutable result-observation clock.
    return numeric_values({k: v for k, v in row.items() if k != 'result'})


def ticket_semantic(ticket):
    out = numeric_values(dict(ticket))
    out['legs'] = sorted((row_semantic(r) for r in ticket['legs']), key=canonical)
    return out


def document_semantic(body, kind):
    out = numeric_values({k: v for k, v in body.items() if k not in {'version', 'updatedAt'}})
    if kind == 'edition':
        out['props'] = sorted((row_semantic(r) for r in body['props']), key=canonical)
    else:
        out['tickets'] = sorted((ticket_semantic(r) for r in body['tickets']), key=canonical)
        if 'modelTargets' in body:
            out['modelTargets'] = sorted((ticket_semantic(r) for r in body['modelTargets']), key=canonical)
    return out


def documents(root, accepted=None):
    for kind, directory in [('edition', 'data/editions'), ('parlay', 'data/plus-money')]:
        manifest = read(root, directory + '/manifest.json')
        seen = set()
        for entry in manifest['editions']:
            name = directory + '/' + entry['path']
            if name in seen: raise ValueError('Duplicate immutable manifest path')
            seen.add(name)
            if accepted and accepted['immutable'].get(name) == file_sha(safe(root, name)): continue
            body = read(root, name)
            if body['date'] != entry['date'] or body['version'] != entry['version']:
                raise ValueError('Manifest/body identity mismatch')
            # Full publication schema/digest validation also runs in build.py.
            scope = '/'.join([kind, body.get('channel', 'daily'), body['date']])
            yield scope, name, body, document_semantic(body, kind)


def snapshot(root, accepted=None):
    accepted = accepted or {}
    docs = {k: set(v) for k, v in accepted.get('documents', {}).items()}
    records = {k: set(v) for k, v in accepted.get('records', {}).items()}
    immutable, manifests = {}, {'edition': [], 'parlay': []}
    latest = dict(accepted.get('latest', {})); tracked = dict(accepted.get('latestMembership', {}))
    for kind, directory in [('edition', 'data/editions'), ('parlay', 'data/plus-money')]:
        for entry in read(root, directory + '/manifest.json')['editions']:
            name = directory + '/' + entry['path']
            if name in immutable: raise ValueError('Duplicate immutable manifest path')
            immutable[name] = file_sha(safe(root, name)); manifests[kind].append(name)
    for scope, name, body, semantic in documents(root, accepted):
        kind = scope.split('/')[0]
        latest[scope] = digest(semantic)
        tracked[scope] = ([r['id'] for r in body['props'] if r.get('group') == 'ry' or r.get('category') in {'value_safe', 'high_probability_aggressive'}] if kind == 'edition' else [r['id'] for r in body['tickets']] + [r['id'] for r in body.get('modelTargets', [])])
        docs.setdefault(scope, set()).add(digest(semantic))
        groups = [('props', body['props'])] if kind == 'edition' else [('tickets', body['tickets']), ('modelTargets', body.get('modelTargets', []))]
        for group, rows in groups:
            ids = set()
            for row in rows:
                identity = row['id']
                if identity in ids: raise ValueError('Duplicate public membership identity')
                ids.add(identity); key = scope + '/' + group + '/' + identity
                records.setdefault(key, set()).add(digest(row_semantic(row) if group == 'props' else ticket_semantic(row)))
    return {'latest': latest, 'latestMembership': tracked, 'documents': {k: sorted(v) for k, v in sorted(docs.items())},
            'records': {k: sorted(v) for k, v in sorted(records.items())},
            'statTargetsSHA256': digest(read(root, 'data/stat-targets.json')),
            'withdrawalsSHA256': digest(read(root, 'assets/parlay-withdrawals.json')),
            'immutable': immutable, 'manifestPaths': manifests}


def semantic_identity(state):
    return digest({k: state[k] for k in ('documents', 'records', 'latest', 'statTargetsSHA256', 'withdrawalsSHA256')})


def load_anchor(root):
    path = safe(root, ANCHOR_PATH)
    if file_sha(path) != ANCHOR_SHA256: raise ValueError('Reviewed release anchor changed')
    anchor = json.loads(path.read_text())
    if anchor['schemaVersion'] != 'sbos-release-anchor-1': raise ValueError('Unknown release anchor')
    return anchor


def comparison(root):
    anchor = load_anchor(root); old = anchor['state']; new = snapshot(root, old)
    for kind, prefix in old['manifestPaths'].items():
        if new['manifestPaths'][kind][:len(prefix)] != prefix:
            raise ValueError('Published immutable manifest history was removed/reordered')
    for name, sha in old['immutable'].items():
        if new['immutable'].get(name) != sha: raise ValueError('Published immutable edition changed: ' + name)
    # Withdrawal history is protected separately; extending it needs review.
    changed = {scope: sorted(set(hashes) - set(old['documents'].get(scope, [])))
               for scope, hashes in new['documents'].items() if set(hashes) - set(old['documents'].get(scope, []))}
    for scope, sha in new['latest'].items():
        if sha != old['latest'].get(scope): changed.setdefault(scope, [sha])
    return anchor, new, changed


def changed_rows(root, anchor):
    seen = set()
    for scope, name, body, semantic in documents(root, anchor['state']):
        if digest(semantic) in anchor['state']['documents'].get(scope, []): continue
        kind = scope.split('/')[0]
        for group, rows in ([('props', body['props'])] if kind == 'edition' else [('tickets', body['tickets']), ('modelTargets', body.get('modelTargets', []))]):
            for row in rows:
                key = scope + '/' + group + '/' + row['id']
                sha = digest(row_semantic(row) if group == 'props' else ticket_semantic(row))
                if sha not in anchor['state']['records'].get(key, []) and (key, sha) not in seen:
                    seen.add((key, sha)); yield scope, group, row


def first_tips(root, anchor):
    tips = []
    for _, group, row in changed_rows(root, anchor):
        rows = [row] if group == 'props' else row['legs']
        tips.extend(stamp(r['startTime']) for r in rows)
    return tips


def _hash(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def verify(root, now=None):
    supplied_now = now
    anchor, state, changes = comparison(root); target = semantic_identity(state)
    if target == semantic_identity(anchor['state']):
        return {'status': 'unchanged', 'targetSHA256': target, 'note': 'Results-only or unchanged; source identity and original clocks retained.'}
    receipt = read(root, RECEIPT_PATH)
    required = {'schemaVersion', 'anchorSHA256', 'targetSHA256', 'reviewedAt', 'evidenceSHA256', 'sgpDisposition', 'experimentalPromotion', 'receiptSHA256'}
    if set(receipt) != required or receipt['schemaVersion'] != SCHEMA or receipt['receiptSHA256'] != digest({k: v for k, v in receipt.items() if k != 'receiptSHA256'}):
        raise ValueError('Invalid coordinated release review')
    if receipt['anchorSHA256'] != ANCHOR_SHA256 or receipt['targetSHA256'] != target:
        raise ValueError('Coordinated review does not bind the actual staged revision')
    if receipt['experimentalPromotion'] is not False or receipt['sgpDisposition'] != 'no_new_sgp_qualified':
        raise ValueError('Experimental/SGP activation requires a separate reviewed implementation')
    if set(receipt['evidenceSHA256']) != EVIDENCE_ROLES or not all(_hash(v) for v in receipt['evidenceSHA256'].values()):
        raise ValueError('Incomplete exact-revision research/membership/exposure evidence')
    reviewed = stamp(receipt['reviewedAt'])
    tips = first_tips(root, anchor)
    now = supplied_now or datetime.now(timezone.utc)
    if reviewed > now: raise ValueError('Coordinated review clock is in the future')
    if any(reviewed >= tip for tip in tips): raise ValueError('New selections were not reviewed before tip')
    if any(now >= tip for tip in tips):
        # Confirmation is a separately reviewed single-publisher deployment
        # observation, never inferred from the staged row's postedAt field.
        proof = read(root, CONFIRMATION_PATH)
        if set(proof) != {'schemaVersion', 'targetSHA256', 'reviewSHA256', 'publishedAt', 'sourceSHA', 'deploymentId', 'verificationSHA256'} or proof['schemaVersion'] != 'sbos-release-publication-1':
            raise ValueError('Exact-revision publication confirmation required after tip')
        if proof['targetSHA256'] != target or proof['reviewSHA256'] != receipt['receiptSHA256'] or not _hash(proof['verificationSHA256']):
            raise ValueError('Publication confirmation revision mismatch')
        if not isinstance(proof['sourceSHA'], str) or len(proof['sourceSHA']) != 40 or not all(c in '0123456789abcdef' for c in proof['sourceSHA']) or not proof['deploymentId']:
            raise ValueError('Missing verified source/deployment identity')
        published = stamp(proof['publishedAt'])
        if not reviewed <= published <= now or any(published >= tip for tip in tips):
            raise ValueError('New selections cannot first publish at or after tip')
    return {'status': 'reviewed', 'targetSHA256': target, 'reviewSHA256': receipt['receiptSHA256'],
            'changedScopes': sorted(changes), 'note': 'Exact revision reviewed; quote age alone is not a publication deadline.'}


def verify_selection_transport(root, artifact):
    # A rewritten artifact receipt must not bless different selection data.
    # Permit only the existing builder's lossless JSON whitespace compaction.
    from build_hosts import json_tokens
    _, state, _ = comparison(root)
    names = set(state['immutable']) | {'data/editions/manifest.json', 'data/plus-money/manifest.json',
                                      'data/stat-targets.json', 'assets/parlay-withdrawals.json'}
    for name in names:
        source = safe(root, name).read_bytes(); built = safe(artifact, name).read_bytes()
        if source != built and (not name.endswith('.json') or json_tokens(source) != built):
            raise ValueError('Artifact selection data differs from reviewed source: ' + name)


def verify_artifact_source(root, artifact, source):
    # A local inventory can be rewritten together with an altered asset.
    # Independently rebuild every generated page, view, header and asset from
    # the clean source into a disposable directory, preserving existing outputs.
    import build
    from build_hosts import assemble, validate_policy
    policy = validate_policy(read(root, 'hosting-policy.json'))
    with tempfile.TemporaryDirectory(prefix='sbos-artifact-review-') as directory:
        scratch = Path(directory).resolve()
        baseline = scratch / 'dist'
        build.build(root, publish=True, destination=baseline)
        expected = scratch / 'cloudflare'
        assemble(baseline, expected, scratch / 'github', policy, source)
        expected_receipt = read(expected, '_sbos-release.json')
        actual_receipt = read(artifact, '_sbos-release.json')
        for name, sha in expected_receipt['files'].items():
            if file_sha(safe(artifact, name.lstrip('/'))) != sha:
                raise ValueError('Artifact differs from independently rebuilt source: ' + name)
        expected_receipt['coordinatedRelease'] = actual_receipt.get('coordinatedRelease')
        if canonical(actual_receipt) != canonical(expected_receipt):
            raise ValueError('Artifact receipt differs from independently rebuilt source')


def verify_artifact(root, artifact, require_clean=True):
    verdict = verify(root)
    if require_clean and subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Commit the reviewed source before upload')
    source = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    receipt = read(artifact, '_sbos-release.json')
    if receipt['sourceSHA'] != source or receipt['canonicalOrigin'] != 'https://starsballonsundays.com':
        raise ValueError('Build/source identity mismatch')
    if receipt.get('coordinatedRelease') != verdict:
        raise ValueError('Build was not gated for the actual staged revision')
    actual = {}
    for p in Path(artifact).rglob('*'):
        if p.is_symlink(): raise ValueError('Linked artifact refused')
        if p.is_file() and p != Path(artifact)/'_sbos-release.json': actual['/' + p.relative_to(artifact).as_posix()] = file_sha(p)
    if actual != receipt['files']: raise ValueError('Artifact inventory or bytes changed after build')
    verify_selection_transport(root, artifact)
    verify_artifact_source(root, artifact, source)
    from build_hosts import publication_window
    from pending_additions import verify_pending_additions
    from pending_parlays import verify_pending_parlays
    publication_window(Path(root)); verify_pending_additions(Path(root)); verify_pending_parlays(Path(root))
    if verify(root) != verdict: raise ValueError('Revision changed or crossed tip during artifact verification')
    if require_clean and subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Source changed during artifact verification')
    if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != source:
        raise ValueError('Source commit changed during artifact verification')
    return verdict


def main():
    cli = argparse.ArgumentParser(); cli.add_argument('--root', type=Path, required=True); cli.add_argument('--artifact', type=Path)
    args = cli.parse_args()
    result = verify_artifact(args.root, args.artifact) if args.artifact else verify(args.root)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__': main()
