"""Require a matching healthy Cloudflare release before publishing GitHub handoffs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

ORIGIN='https://starsballonsundays.com'


def verify(receipt,expected,fetch):
    if receipt.get('schemaVersion')!='sbos-public-release-1' or receipt.get('sourceSHA')!=expected or receipt.get('canonicalOrigin')!=ORIGIN:raise ValueError('Cloudflare has not published the exact source commit')
    # Check every page and the current edition index. Immutable asset/data bytes
    # are already validated by the shared build and recorded in this receipt.
    paths=[p for p in receipt['files'] if p.endswith('.html')]+['/data/editions/manifest.json']
    for path in paths:
        if hashlib.sha256(fetch(path)).hexdigest()!=receipt['files'][path]:raise ValueError('Cloudflare content differs: '+path)
    if hashlib.sha256(fetch('/data/editions/manifest.json')).hexdigest()!=receipt['editionManifestSHA256']:raise ValueError('Cloudflare edition history differs')
    return len(paths)


def main():
    root=Path(__file__).resolve().parents[1]
    if json.loads((root/'hosting-policy.json').read_text())['githubMode']!='redirect':
        print('GitHub remains the full site; domain gate is inactive.');return
    parser=argparse.ArgumentParser();parser.add_argument('--attempts',type=int,default=24);parser.add_argument('--interval',type=int,default=10);args=parser.parse_args()
    expected=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    def fetch(path):
        request=urllib.request.Request(ORIGIN+path,headers={'Cache-Control':'no-cache','User-Agent':'SBOS-public-release-verification'})
        with urllib.request.urlopen(request,timeout=20) as response:
            if response.status!=200:raise ValueError('Unhealthy Cloudflare response')
            if not response.url.startswith(ORIGIN+'/'):raise ValueError('Unexpected host redirect')
            return response.read()
    for attempt in range(args.attempts):
        try:
            count=verify(json.loads(fetch('/_sbos-release.json')),expected,fetch)
            print(f'Cloudflare exact source {expected}: {count} public page/index checks passed.');return
        except Exception as error:
            if attempt+1==args.attempts:raise
            print('Waiting for verified Cloudflare release: '+str(error),flush=True);time.sleep(args.interval)


if __name__=='__main__':main()
