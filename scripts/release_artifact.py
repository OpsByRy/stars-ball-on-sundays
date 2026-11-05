"""Seal and verify complete host outputs without rebuilding or fetching inputs.

The manifest digest must come from the trusted build job, not the download.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat

ROOTS = ('dist-cloudflare', 'dist-github')
MANIFEST = 'artifact-manifest.json'
SCHEMA = 'sbos-build-artifact-1'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inventory(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Artifact root must be a real directory')
    result = {}
    for path in sorted(root.rglob('*')):
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ValueError('Unsafe artifact entry: ' + str(path))
        if stat.S_ISREG(mode):
            name = path.relative_to(root).as_posix()
            result[name] = {'sha256': digest(path), 'bytes': path.stat().st_size}
    return result


def payload(root):
    result = {}
    for name in ROOTS:
        files = inventory(root / name)
        if 'index.html' not in files:
            raise ValueError('Missing host index: ' + name)
        result.update({name + '/' + key: value for key, value in files.items()})
    return result


def check_sha(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('Invalid source SHA')


def seal(source, destination, source_sha):
    check_sha(source_sha)
    # Inspect before copying, so copytree cannot dereference a symlink.
    before = payload(source)
    marker = json.loads((source / 'dist-cloudflare/_sbos-release.json').read_text())
    if marker.get('sourceSHA') != source_sha:
        raise ValueError('Release marker source mismatch')
    if destination.exists():
        raise ValueError('Refusing to replace an existing sealed artifact')
    destination.mkdir(parents=True)
    for name in ROOTS:
        shutil.copytree(source / name, destination / name)
    if payload(destination) != before:
        raise ValueError('Output changed during sealing')
    body = {'schemaVersion': SCHEMA, 'sourceSHA': source_sha, 'files': before}
    (destination / MANIFEST).write_text(json.dumps(body, sort_keys=True, separators=(',', ':')) + '\n')
    return verify(destination, source_sha, digest(destination / MANIFEST))


def verify(root, source_sha, manifest_sha):
    check_sha(source_sha)
    if not re.fullmatch(r'[0-9a-f]{64}', manifest_sha):
        raise ValueError('Expected manifest SHA256 is required')
    actual = inventory(root)
    if MANIFEST not in actual or digest(root / MANIFEST) != manifest_sha:
        raise ValueError('Artifact manifest digest mismatch')
    body = json.loads((root / MANIFEST).read_text())
    if set(body) != {'schemaVersion', 'sourceSHA', 'files'} or body['schemaVersion'] != SCHEMA or body['sourceSHA'] != source_sha:
        raise ValueError('Artifact provenance mismatch')
    del actual[MANIFEST]
    if actual != body['files'] or payload(root) != actual:
        raise ValueError('Artifact file inventory or digest mismatch')
    marker = json.loads((root / 'dist-cloudflare/_sbos-release.json').read_text())
    if marker.get('sourceSHA') != source_sha:
        raise ValueError('Release marker source mismatch')
    return {'sourceSHA': source_sha, 'manifestSHA256': manifest_sha, 'fileCount': len(actual),
            'totalBytes': sum(row['bytes'] for row in actual.values())}


def compare(left, right):
    a, b = payload(left), payload(right)
    if a != b:
        changed = sorted(key for key in a.keys() | b.keys() if a.get(key) != b.get(key))
        raise ValueError('Host outputs differ: ' + ', '.join(changed[:30]))
    return {'equivalent': True, 'fileCount': len(a), 'comparison': 'exact paths, sizes, and SHA256; no normalization'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('seal')
    p.add_argument('--source', type=Path, default=Path('.'))
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--source-sha', required=True)
    p = sub.add_parser('verify')
    p.add_argument('--artifact', type=Path, required=True)
    p.add_argument('--source-sha', required=True)
    p.add_argument('--manifest-sha', required=True)
    p = sub.add_parser('compare')
    p.add_argument('left', type=Path)
    p.add_argument('right', type=Path)
    args = parser.parse_args()
    if args.command == 'seal':
        result = seal(args.source, args.output, args.source_sha)
    elif args.command == 'verify':
        result = verify(args.artifact, args.source_sha, args.manifest_sha)
    else:
        result = compare(args.left, args.right)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
