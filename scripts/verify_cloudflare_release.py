"""Require a matching healthy Cloudflare release before publishing GitHub handoffs."""
import argparse
import base64
import binascii
from itertools import islice
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request

ORIGIN='https://starsballonsundays.com'
# The owned zone adds this public Cloudflare Web Analytics beacon at the edge.
# Accept only its known token, vendor URL/SRI format and final-body position.
# Every other byte remains covered by the publication hash.
CLOUDFLARE_BEACON=re.compile(rb'<script type="module" src="https://static\.cloudflareinsights\.com/beacon\.min\.js/v[0-9a-f]{32,64}" integrity="sha512-[A-Za-z0-9+/]{86}==" data-cf-beacon=\'\{"version":"[0-9]{4}\.[0-9]{1,2}\.[0-9]+","token":"1ea6993beccf4beeb1b3927d67da293f","r":1,"spa":2\}\' crossorigin="anonymous"></script>\n(?=</body></html>\s*\Z)')
_CLOUDFLARE_BODY_END=rb'(?=</body></html>\s*\Z)'
_CLOUDFLARE_BEACON_BLOCK=re.compile(CLOUDFLARE_BEACON.pattern.removesuffix(_CLOUDFLARE_BODY_END))


# Pin only the observed edge JSD loader, not arbitrary inline JavaScript.
# The two request fields are bounded and the ray in the URL must agree.
# A future vendor program/format needs a separate compatibility review.
_CLOUDFLARE_JSD_TEMPLATE = b'<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement(\'script\');d.innerHTML="window.__CF$cv$params={r:\'RAY_ID\',t:\'EPOCH_B64\'};var l=window.parent.location,o;try{o=new URL(l.origin).origin}catch(e){try{o=new URL(new URL(l.href).origin).origin}catch(e){o=\'\'}}var u=\'/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=RAY_ID\',a=document.createElement(\'script\');a.src=o?new URL(u,o).href:u;document.getElementsByTagName(\'head\')[0].appendChild(a);";b.getElementsByTagName(\'head\')[0].appendChild(d)}}if(document.body){var a=document.createElement(\'iframe\');a.height=1;a.width=1;a.style.position=\'absolute\';a.style.top=0;a.style.left=0;a.style.border=\'none\';a.style.visibility=\'hidden\';document.body.appendChild(a);if(\'loading\'!==document.readyState)c();else if(window.addEventListener)document.addEventListener(\'DOMContentLoaded\',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);\'loading\'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>'
CLOUDFLARE_JSD = re.compile(
    re.escape(_CLOUDFLARE_JSD_TEMPLATE)
    .replace(b'RAY_ID',rb'(?P<ray>[0-9a-f]{16})',1)
    .replace(b'EPOCH_B64',rb'(?P<epoch>[A-Za-z0-9+/]{14}==)',1)
    .replace(b'RAY_ID',rb'(?P=ray)',1)
    + _CLOUDFLARE_BODY_END)
_CLOUDFLARE_JSD_BLOCK=re.compile(CLOUDFLARE_JSD.pattern.removesuffix(_CLOUDFLARE_BODY_END))


def normalize_public_html(body):
    # Parse at most two matches of each exact grammar; duplicates fail closed.
    # Remove one contiguous terminal envelope atomically, never strip in a loop.
    jsds=list(islice(_CLOUDFLARE_JSD_BLOCK.finditer(body),2))
    beacons=list(islice(_CLOUDFLARE_BEACON_BLOCK.finditer(body),2))
    if len(jsds)>1 or len(beacons)>1:return body
    blocks=sorted(jsds+beacons,key=lambda match:match.start())
    if not blocks:return body
    if len(blocks)==2 and blocks[0].end()!=blocks[1].start():return body
    if not re.fullmatch(rb'</body></html>\s*',body[blocks[-1].end():]):return body
    if jsds:
        encoded=jsds[0]['epoch']
        try:epoch=base64.b64decode(encoded,validate=True)
        except binascii.Error:return body
        if not re.fullmatch(rb'[0-9]{10}',epoch) or base64.b64encode(epoch)!=encoded:return body
    return body[:blocks[0].start()]+body[blocks[-1].end():]


def verify(receipt,expected,fetch):
    if receipt.get('schemaVersion')!='sbos-public-release-1' or receipt.get('sourceSHA')!=expected or receipt.get('canonicalOrigin')!=ORIGIN:raise ValueError('Cloudflare has not published the exact source commit')
    # Check every page/index and the exact transport bytes of any large JSON
    # compacted by the build. Original immutable source hashes stay separate.
    paths=list(dict.fromkeys([p for p in receipt['files'] if p.endswith('.html')]
        +['/data/editions/manifest.json']+list(receipt.get('compactedJSON',{}))))
    for path in paths:
        body=fetch(path)
        if path.endswith('.html'):body=normalize_public_html(body)
        if hashlib.sha256(body).hexdigest()!=receipt['files'][path]:raise ValueError('Cloudflare content differs: '+path)
    if hashlib.sha256(fetch('/data/editions/manifest.json')).hexdigest()!=receipt['editionManifestSHA256']:raise ValueError('Cloudflare edition history differs')
    return len(paths)


def main():
    root=Path(__file__).resolve().parents[1]
    if json.loads((root/'hosting-policy.json').read_text())['githubMode']!='redirect':
        print('GitHub remains the full site; domain gate is inactive.');return
    parser=argparse.ArgumentParser();parser.add_argument('--attempts',type=int,default=120);parser.add_argument('--interval',type=int,default=10);parser.add_argument('--origin',default=ORIGIN);parser.add_argument('--artifact',type=Path);args=parser.parse_args()
    if args.origin != ORIGIN and not re.fullmatch(r'https://[0-9a-f]{8}\.sbos-public\.pages\.dev',args.origin):
        raise ValueError('Unapproved verification origin')
    local_receipt=json.loads((args.artifact/'_sbos-release.json').read_text()) if args.artifact else None
    expected=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    def fetch(path):
        request=urllib.request.Request(args.origin+path,headers={'Cache-Control':'no-cache','User-Agent':'SBOS-public-release-verification'})
        with urllib.request.urlopen(request,timeout=20) as response:
            if response.status!=200:raise ValueError('Unhealthy Cloudflare response')
            if not response.url.startswith(args.origin+'/'):raise ValueError('Unexpected host redirect')
            return response.read()
    for attempt in range(args.attempts):
        try:
            receipt=json.loads(fetch('/_sbos-release.json'))
            if local_receipt is not None and receipt != local_receipt:
                raise ValueError('Hosted receipt differs from the sealed artifact')
            count=verify(receipt,expected,fetch)
            print(f'Cloudflare exact source {expected}: {count} public page/index checks passed.');return
        except Exception as error:
            if attempt+1==args.attempts:raise
            print('Waiting for verified Cloudflare release: '+str(error),flush=True);time.sleep(args.interval)


if __name__=='__main__':main()
