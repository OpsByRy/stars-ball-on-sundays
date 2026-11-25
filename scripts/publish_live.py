"""Publish a live layer built by build_live.py: upload, switch the pointer, verify, or roll back.

R2 bucket sbos-public-data (S3 API, a token scoped to that bucket only):
  blobs/<sha256>        file bytes, create-only, stored with their SHA-256 checksum
  layers/<id>.json      the layer descriptor, create-only
  current.json          the pointer the sbos-live-data Worker reads; changed only by
                        compare-and-swap on its ETag, every value also kept in history/
  history/<n>.json      every pointer value ever set (audit trail, rollback)

After the switch every layer file is fetched from https://starsballonsundays.com and must
match its recorded hash; otherwise the previous pointer is restored and this exits non-zero.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

POINTER = 'current.json'
SITE = 'https://starsballonsundays.com'
HEADERS = {'User-Agent': 'sbos-live-lane/1', 'Cache-Control': 'no-cache'}


def client():
    import boto3
    from botocore.config import Config
    return boto3.client('s3', endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
                        region_name='auto', config=Config(retries={'max_attempts': 5, 'mode': 'standard'},
                                                         request_checksum_calculation='when_required', response_checksum_validation='when_required'))


def exists(s3, bucket, key):
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except s3.exceptions.ClientError as error:
        if error.response['Error']['Code'] in ('404', 'NoSuchKey', 'NotFound'):
            return False
        raise


def put_once(s3, bucket, key, body, content_type='application/json'):
    """Create-only upload with the SHA-256 checksum R2 keeps (the Worker compares it)."""
    if exists(s3, bucket, key):
        return False
    checksum = base64.b64encode(hashlib.sha256(body).digest()).decode()
    s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type, ChecksumSHA256=checksum, IfNoneMatch='*')
    return True


def read_pointer(s3, bucket):
    try:
        got = s3.get_object(Bucket=bucket, Key=POINTER)
    except s3.exceptions.NoSuchKey:
        return None, None
    return json.loads(got['Body'].read()), got['ETag']


def swap_pointer(s3, bucket, value, etag):
    body = (json.dumps(value, sort_keys=True, indent=1) + '\n').encode()
    condition = {'IfMatch': etag} if etag else {'IfNoneMatch': '*'}
    s3.put_object(Bucket=bucket, Key=POINTER, Body=body, ContentType='application/json', **condition)
    put_once(s3, bucket, f"history/{value['generation']:08d}.json", body)


def ancestor(repo, older, newer):
    return subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', older, newer]).returncode == 0


def fetch_hash(path):
    request = urllib.request.Request(SITE + path, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        return hashlib.sha256(response.read()).hexdigest()


def verify(descriptor, attempts=12, wait=10):
    """Every layer file through the real site; the Worker refreshes its pointer within seconds."""
    pending = dict(descriptor['files'])
    for _ in range(attempts):
        for path, entry in list(pending.items()):
            try:
                if fetch_hash(path) == entry.get('servedSHA256', entry['sha256']):
                    del pending[path]
            except Exception:
                pass
        if not pending:
            return []
        time.sleep(wait)
    return sorted(pending)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('layer', help='Directory written by build_live.py (layer.json + blobs/)')
    parser.add_argument('--bucket', default='sbos-public-data')
    parser.add_argument('--repo', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--shadow', action='store_true', help='Upload only; never move the pointer')
    args = parser.parse_args(argv)
    folder = Path(args.layer)
    descriptor = json.loads((folder / 'layer.json').read_text())
    s3 = client()
    uploaded = 0
    for path, entry in descriptor['files'].items():
        body = (folder / 'blobs' / entry['sha256']).read_bytes()
        if hashlib.sha256(body).hexdigest() != entry['sha256'] or len(body) != entry['bytes']:
            raise SystemExit(f'Layer blob for {path} does not match its descriptor')
        uploaded += put_once(s3, args.bucket, 'blobs/' + entry['sha256'], body)
    layer_key = f"layers/{descriptor['layerId']}.json"
    put_once(s3, args.bucket, layer_key, (folder / 'layer.json').read_bytes())
    result = {'layerId': descriptor['layerId'], 'files': len(descriptor['files']), 'blobsUploaded': uploaded}
    if args.shadow:
        print(json.dumps({**result, 'pointer': 'unchanged (shadow)'}))
        return 0
    current, etag = read_pointer(s3, args.bucket)
    if current and current.get('layerId') and current['baseSourceSHA'] == descriptor['baseSourceSHA'] \
            and current['sourceSHA'] != descriptor['sourceSHA'] and not ancestor(args.repo, current['sourceSHA'], descriptor['sourceSHA']):
        raise SystemExit(f"Refusing to replace live layer for {current['sourceSHA'][:12]} with an older or unrelated commit")
    value = {'schemaVersion': 'sbos-live-pointer-1', 'generation': (current or {}).get('generation', 0) + 1,
             'layerId': descriptor['layerId'] if descriptor['files'] else None, 'sourceSHA': descriptor['sourceSHA'],
             'baseSourceSHA': descriptor['baseSourceSHA'], 'activatedAt': datetime.now(timezone.utc).isoformat()}
    swap_pointer(s3, args.bucket, value, etag)
    failed = verify(descriptor) if descriptor['files'] else []
    if failed:
        _, newer = read_pointer(s3, args.bucket)
        restore = {**(current or {'schemaVersion': 'sbos-live-pointer-1', 'layerId': None, 'sourceSHA': descriptor['baseSourceSHA'],
                                  'baseSourceSHA': descriptor['baseSourceSHA']}),
                   'generation': value['generation'] + 1, 'activatedAt': datetime.now(timezone.utc).isoformat(), 'restoredAfterFailedVerify': descriptor['layerId']}
        swap_pointer(s3, args.bucket, restore, newer)
        print(json.dumps({**result, 'pointer': 'restored', 'notServedAsBuilt': failed[:20]}))
        return 1
    print(json.dumps({**result, 'pointer': value}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
