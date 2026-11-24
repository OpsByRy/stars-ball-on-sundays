"""Build two public hosting outputs from the existing validated publication build.

GitHub stays a full site until policy explicitly activates the browser handoff.
No engine checkout, network data source, credential or deployment API is used.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor,ThreadPoolExecutor
from concurrent.futures.process import BrokenProcessPool
import hashlib
import html
import json
import multiprocessing
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime,timezone,timedelta
import build
from pending_additions import verify_pending_additions
from pending_parlays import verify_pending_parlays
import json_transport

OLD = 'https://opsbyry.github.io/stars-ball-on-sundays/'
ORIGIN = 'https://starsballonsundays.com'
PREFIX = '/stars-ball-on-sundays'
PRIVATE_PATH = re.compile(r'(^|/)(?:\.git|\.env(?:\..*)?|\.local-data|pipeline|server|private-lab|functions)(?:/|$)|(?:\.map|\.csv|\.py|\.cjs|\.sqlite3?|\.db)$|(^|/)_worker\.js$', re.I)
PAGES_MAX_BYTES = 25*1024*1024
IMMUTABLE_EDITION = re.compile(r'data/editions/(?:daily|sunday)/\d{4}-\d{2}-\d{2}/[0-9a-f]{16}\.json')


# From an opening quote to its unescaped closing quote (any byte may follow a backslash),
# or to the end of the input; otherwise a run of formatting whitespace. Strings are always
# consumed whole from where they start, so whitespace inside them is never touched.
_JSON_STRING_OR_SPACE=re.compile(rb'("[^"\\]*(?:\\.[^"\\]*)*(?:"|\\?\Z))|[ \t\r\n]+',re.DOTALL)


def _strip_formatting(raw):
    return _JSON_STRING_OR_SPACE.sub(rb'\1',raw)  # an unmatched group (whitespace) becomes b''


def _strip_formatting_reference(raw):
    """The original byte-by-byte scanner; tests require _strip_formatting to match it exactly."""
    out=bytearray();quoted=False;escaped=False
    for char in raw:
        if quoted:
            out.append(char)
            if escaped:escaped=False
            elif char==92:escaped=True
            elif char==34:quoted=False
        elif char==34:quoted=True;out.append(char)
        elif char not in b' \t\r\n':out.append(char)
    return bytes(out)


def json_tokens(raw):
    """Remove formatting only, preserving every string and number token byte.

    The regex engine does what the original Python loop did over every byte; ~110
    oversized editions are ~3 billion bytes, which was most of the host build's time.
    """
    json.loads(raw)  # Reject invalid JSON before scanning its lexical form.
    return _strip_formatting(raw)


def pages_asset(name,raw,limit=PAGES_MAX_BYTES):
    if len(raw)<=limit:return raw
    if name.startswith('data/') and name.endswith('.json'):
        compact=json_tokens(raw)
        if len(compact)<=limit:return compact
    raise ValueError('Pages file exceeds 25 MiB: '+name)


_PAGES_ASSET,_PAGES_MAX_BYTES=pages_asset,PAGES_MAX_BYTES


def publication_window(root,now=None):
    """Verify a pending quote's provenance; quote age alone never blocks release.

    The legacy window marker's validUntil is retained as historical context,
    not an expiry for already-reviewed picks. New context markers omit it.
    """
    marker=root/'publication-window.json'
    if not marker.exists():return 'no pending publication window'
    body=json.loads(marker.read_text())
    fields={'schemaVersion','channel','date','editionVersion','quoteObservedAt'}
    legacy=body.get('schemaVersion')=='sbos-publication-window-1'
    if legacy:fields.add('validUntil')
    if set(body)!=fields or body['schemaVersion'] not in {'sbos-publication-window-1','sbos-publication-context-1'} or body['channel']!='daily':
        raise ValueError('Invalid publication context')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',body['date']) or not re.fullmatch(r'[0-9a-f]{16}',body['editionVersion']):
        raise ValueError('Invalid publication window identity')
    def stamp(value):
        instant=datetime.fromisoformat(value.replace('Z','+00:00'))
        if instant.utcoffset() is None:raise ValueError('Publication window requires explicit timezone')
        return instant.astimezone(timezone.utc)
    observed=stamp(body['quoteObservedAt'])
    if legacy and stamp(body['validUntil'])-observed!=timedelta(minutes=15):
        raise ValueError('Legacy publication window has an invalid recorded interval')
    manifest=json.loads((root/'data/editions/manifest.json').read_text())
    target=[e for e in manifest['editions'] if e['channel']==body['channel'] and e['date']==body['date'] and e['version']==body['editionVersion']]
    if len(target)!=1:raise ValueError('Pending publication edition is missing from validated history')
    relative=f"data/editions/daily/{body['date']}/{body['editionVersion']}.json"
    edition=json.loads(build.safe_file(root,relative).read_text())
    canonical=build.canonical({k:v for k,v in edition.items() if k!='version'})
    if edition.get('version')!=body['editionVersion'] or hashlib.sha256(canonical).hexdigest()[:16]!=body['editionVersion']:
        raise ValueError('Pending publication edition identity differs')
    quotes=[]
    for row in edition['props']:
        quotes.extend(q['capturedAt'] for q in row.get('bookPrices',{}).get('quotes',[]) if q.get('capturedAt'))
        if row.get('priceCheck',{}).get('sourceAsOf'):quotes.append(row['priceCheck']['sourceAsOf'])
        if row.get('capturedAt'):quotes.append(row['capturedAt'])
    if not quotes or max(stamp(q) for q in quotes)!=observed:
        raise ValueError('Pending publication quote clock disagrees with saved edition observations')
    now=now or datetime.now(timezone.utc)
    if now.utcoffset() is None or observed>now:
        raise ValueError('Publication quote observation cannot be in the future')
    return 'quote observation verified; saved quote age alone does not block publication'


def validate_policy(policy):
    expected={'schemaVersion','canonicalOrigin','cloudflareAccountId','cloudflareProject','githubMode'}
    if set(policy)!=expected or policy['schemaVersion']!='sbos-hosting-1':
        raise ValueError('Unknown hosting policy')
    if policy['canonicalOrigin']!=ORIGIN or policy['cloudflareAccountId']!='fbdf495767bb144edfcbb7f1609e2629' or policy['cloudflareProject']!='sbos-public':
        raise ValueError('Unapproved hosting destination/account')
    if policy['githubMode'] not in {'site','redirect'}:raise ValueError('Unknown GitHub mode')
    return policy


def sha256(file):return hashlib.sha256(file.read_bytes()).hexdigest()


def clean_route(name):
    if name=='index.html':return '/'
    return '/'+(name[:-10] if name.endswith('/index.html') else name[:-5])


def page_routes(name):
    if name=='index.html':old=[PREFIX,PREFIX+'/',PREFIX+'/index.html']
    elif name.endswith('/index.html'):
        directory=name[:-10].rstrip('/')
        old=[PREFIX+'/'+directory,PREFIX+'/'+directory+'/',PREFIX+'/'+name]
    else:old=[PREFIX+'/'+name,PREFIX+'/'+name[:-5]]
    return {key:clean_route(name) for key in old}


def redirect_script(routes):
    return '''/* SBOS public-host handoff. Fixed origin; dates/filters/fragments retained. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SBOS_MIGRATION=api;const next=api.destination(root.location.href);if(next){const link=root.document.getElementById('new-site');if(link)link.href=next;root.location.replace(next);}}})(typeof window==='undefined'?this:window,function(){
'use strict';const routes=Object.freeze(ROUTES);
function destination(input){let from;try{from=new URL(input);}catch{return null;}if(!['https:','http:'].includes(from.protocol)||from.hostname!=='opsbyry.github.io'||from.port||from.username||from.password||!Object.hasOwn(routes,from.pathname))return null;return 'https://starsballonsundays.com'+routes[from.pathname]+from.search+from.hash;}
return Object.freeze({destination,routes});});
'''.replace('ROUTES',json.dumps(routes,sort_keys=True))


def _compact_task(task):
    baseline,name=task
    raw=(baseline/name).read_bytes()
    try:return hashlib.sha256(raw).digest(),pages_asset(name,raw),None
    except ValueError as error:return hashlib.sha256(raw).digest(),None,str(error)


def _precompact(baseline,files):
    """Run pages_asset for the oversized files in parallel processes (each is independent).

    assemble still reads every file itself and uses a result only when the worker saw the
    same bytes (SHA-256); a worker's ValueError is re-raised there exactly where the serial
    call would have raised it. Skipped for a handful of files, or when tests replace
    pages_asset/PAGES_MAX_BYTES (worker processes would not see the replacement).
    """
    if len(files)<4 or pages_asset is not _PAGES_ASSET or PAGES_MAX_BYTES!=_PAGES_MAX_BYTES:return {}
    names=[f.relative_to(baseline).as_posix() for f in files]
    try:
        with ProcessPoolExecutor(max_workers=4,mp_context=multiprocessing.get_context('spawn')) as pool:
            return dict(zip(names,pool.map(_compact_task,[(baseline,name) for name in names])))
    except (BrokenProcessPool,OSError) as error:
        print(f'Parallel compaction unavailable ({error}); continuing serially.',file=sys.stderr);return {}


def assemble(baseline,cf,github,policy,source_sha):
    validate_policy(policy)
    if not re.fullmatch('[0-9a-f]{40}',source_sha):raise ValueError('Invalid source SHA')
    files=sorted(p for p in baseline.rglob('*') if p.is_file())
    if not files or not (baseline/'index.html').is_file():raise ValueError('Missing validated baseline')
    compacted={};compaction_receipts={};encoded_receipts={}
    precompacted=_precompact(baseline,[f for f in files if not f.is_symlink() and f.stat().st_size>PAGES_MAX_BYTES
                                       and not PRIVATE_PATH.search(f.relative_to(baseline).as_posix())])
    for file in files:
        name=file.relative_to(baseline).as_posix()
        if file.is_symlink() or PRIVATE_PATH.search(name):raise ValueError('Private/unsafe artifact path: '+name)
        if file.stat().st_size>PAGES_MAX_BYTES:
            raw=file.read_bytes()
            try:
                done=precompacted.get(name)
                if done is None or done[0]!=hashlib.sha256(raw).digest():compact=pages_asset(name,raw)
                elif done[2] is not None:raise ValueError(done[2])
                else:compact=done[1]
            except ValueError:
                if not IMMUTABLE_EDITION.fullmatch(name):raise
                if not (baseline/'assets/json-transport.js').is_file():raise ValueError('JSON transport reader is missing')
                for page in (p for p in files if p.suffix=='.html'):
                    text=page.read_text()
                    publication=re.search(r'<script\b[^>]*\bsrc=["\'][^"\']*assets/publication\.js',text)
                    transport=re.search(r'<script\b[^>]*\bsrc=["\'][^"\']*assets/json-transport\.js',text)
                    if publication and (not transport or transport.start()>publication.start()):raise ValueError('JSON transport reader must precede publication: '+str(page))
                compact=json_transport.encode(raw)
                if len(compact)>PAGES_MAX_BYTES:raise ValueError('Pages file exceeds 25 MiB: '+name)
                encoded_receipts['/'+name]={'sourceSHA256':hashlib.sha256(raw).hexdigest(),
                    'sourceBytes':len(raw),'deployedSHA256':hashlib.sha256(compact).hexdigest(),
                    'deployedBytes':len(compact),'transformation':'Lossless gzip-base64 JSON transport; original bytes reconstructed exactly'}
            compacted[name]=compact
            if '/'+name not in encoded_receipts:compaction_receipts['/'+name]={'sourceSHA256':hashlib.sha256(raw).hexdigest(),
                'deployedSHA256':hashlib.sha256(compact).hexdigest(),'sourceBytes':len(raw),
                'deployedBytes':len(compact),'transformation':'JSON formatting whitespace only; literal tokens unchanged'}
    for directory in [cf,github]:
        if directory.exists():shutil.rmtree(directory)
        shutil.copytree(baseline,directory)
        for name,raw in compacted.items():(directory/name).write_bytes(raw)
    routes={};pages=[]
    for page in (p for p in files if p.suffix=='.html'):
        name=page.relative_to(baseline).as_posix();pages.append(name);routes.update(page_routes(name))
        body=page.read_text().replace(OLD,ORIGIN+'/')
        body=re.sub(r'((?:rel="canonical" href|property="og:url" content)="https://starsballonsundays\.com/[^"?]*?)\.html(?=")',r'\1',body)
        (cf/name).write_text(body)
        if policy['githubMode']=='redirect':
            target=ORIGIN+clean_route(name)
            canonical=re.search(r'<link rel="canonical" href="([^"]+)"',body)
            canonical=canonical.group(1) if canonical else target
            script='../'*(len(Path(name).parts)-1)+'migration-redirect.js'
            (github/name).write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SBOS has moved</title><meta name="robots" content="noindex"><link rel="canonical" href="'+html.escape(canonical,quote=True)+'"><script defer src="'+script+'"></script></head><body><main><h1>SBOS has moved</h1><p>Visit <a id="new-site" href="'+html.escape(target,quote=True)+'">Stars Ball On Sundays</a>.</p><noscript><p>For a dated or filtered view, select the same date and filters on the new site.</p></noscript></main></body></html>\n')
    (cf/'404.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · SBOS</title><meta name="robots" content="noindex"></head><body><main><h1>Page not found</h1><p><a href="/">Return to Stars Ball On Sundays</a></p></main></body></html>\n')
    (cf/'_headers').write_text('/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/data/*\n  Cache-Control: public, max-age=0, must-revalidate\n/_sbos-release.json\n  Cache-Control: no-store\n')
    if policy['githubMode']=='redirect':
        (github/'migration-redirect.js').write_text(redirect_script(routes))
        (github/'404.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · SBOS</title><meta name="robots" content="noindex"><script defer src="/stars-ball-on-sundays/migration-redirect.js"></script></head><body><main><h1>Page not found</h1><p>SBOS has moved to <a id="new-site" href="https://starsballonsundays.com/">starsballonsundays.com</a>.</p></main></body></html>\n')
    def check(file):
        name=file.relative_to(baseline).as_posix();deployed=sha256(cf/name)
        if file.suffix!='.html':
            original=hashlib.sha256(compacted[name]).hexdigest() if name in compacted else sha256(file)
            if deployed!=original or sha256(github/name)!=original:raise ValueError('Public data/assets changed: '+name)
            if '/'+name in encoded_receipts:
                for host in [cf,github]:
                    if json_transport.decode((host/name).read_bytes())!=file.read_bytes():raise ValueError('JSON source reconstruction differs: '+name)
        return '/'+name,deployed
    # Same checks for every file; threads overlap the hashing (hashlib and zlib release the GIL).
    # map() returns in file order and raises the first failing file's error, as the loop did.
    with ThreadPoolExecutor(max_workers=4) as pool:checks=dict(pool.map(check,files))
    receipt={'schemaVersion':'sbos-public-release-1','sourceSHA':source_sha,'canonicalOrigin':ORIGIN,
             'githubMode':policy['githubMode'],'editionManifestSHA256':sha256(baseline/'data/editions/manifest.json'),
             'files':checks}
    if compaction_receipts:receipt['compactedJSON']=compaction_receipts
    if encoded_receipts:receipt['encodedJSON']=encoded_receipts
    (cf/'_sbos-release.json').write_text(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n')
    if sum(p.is_file() for p in cf.rglob('*'))>20000:raise ValueError('Pages file limit exceeded')
    return {'sourceSHA':source_sha,'githubMode':policy['githubMode'],'pages':pages,'oldRoutes':routes,
            'baselineFileCount':len(files),'cloudflareFileCount':sum(p.is_file() for p in cf.rglob('*')),
            'unchangedNonHTMLFileCount':sum(p.suffix!='.html' and p.relative_to(baseline).as_posix() not in compacted for p in files),
            'compactedJSON':compaction_receipts,'encodedJSON':encoded_receipts}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    policy=validate_policy(json.loads((root/'hosting-policy.json').read_text()))
    source_sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    build.build(root,publish=args.publish)
    receipt=assemble(root/'dist',root/'dist-cloudflare',root/'dist-github',policy,source_sha)
    if args.publish:
        receipt['publicationWindow']=publication_window(root)
        receipt['pendingAdditions']=verify_pending_additions(root)
        receipt['pendingParlays']=verify_pending_parlays(root)
    (root/'hosting-build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({k:v for k,v in receipt.items() if k not in {'pages','oldRoutes'}},indent=2))


if __name__=='__main__':main()
