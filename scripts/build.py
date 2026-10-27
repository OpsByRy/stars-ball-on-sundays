"""Build the public website from an explicit file list and validated result records."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit
from public_schema import validate_edition, validate_manifest, validate_targets

class Links(HTMLParser):
    def __init__(self): super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs): self.links.extend(v for k,v in attrs if k in {'href','src'} and v)

def canonical(body): return json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()

def safe_file(root,name):
    if not isinstance(name,str) or Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name: raise ValueError('Unsafe public path')
    path=root/name
    if any(p.is_symlink() for p in [path,*path.parents] if p==root or root in p.parents): raise ValueError('Public paths cannot be symlinks')
    if not path.is_file(): raise ValueError(f'Missing public file: {name}')
    return path

def publication_files(root):
    index=json.loads(safe_file(root,'data/editions/manifest.json').read_text());validate_manifest(index)
    files=['data/editions/manifest.json','data/stat-targets.json'];published=set()
    for entry in index['editions']:
        name='data/editions/'+entry['path'];body=json.loads(safe_file(root,name).read_text());validate_edition(body)
        if any(body[k]!=entry[k] for k in ('channel','date','version')): raise ValueError('Edition identity mismatch')
        unhashed={k:v for k,v in body.items() if k!='version'}
        if hashlib.sha256(canonical(unhashed)).hexdigest()[:16]!=entry['version']: raise ValueError('Edition digest mismatch')
        if sum(p['group']=='ry' for p in body['props'])!=entry['count'] or sum(p['group']=='research' for p in body['props'])!=entry['researchCount']: raise ValueError('Edition count mismatch')
        published.update((p['date'],p.get('canonicalEventId') or p.get('eventId'),p.get('playerId')) for p in body['props']);files.append(name)
    targets=json.loads(safe_file(root,'data/stat-targets.json').read_text());validate_targets(targets)
    if any((t['date'],t['eventId'],t['playerId']) not in published for t in targets['targets']): raise ValueError('Unpublished candidate identity in public targets')
    return files

def build(root):
    root=Path(root).resolve();destination=root/'dist'
    if destination.is_symlink(): raise ValueError('Destination cannot be a symlink')
    manifest=json.loads(safe_file(root,'site-manifest.json').read_text())
    if set(manifest)!={'files'} or not isinstance(manifest['files'],list): raise ValueError('Invalid site file list')
    files=manifest['files']+publication_files(root)
    if len(set(files))!=len(files): raise ValueError('Duplicate public file')
    for name in manifest['files']:
        if name.startswith('data/') or not (name.endswith('.html') or name.startswith('assets/')): raise ValueError('Only reviewed pages and assets belong in site-manifest')
    # Validate everything before replacing the previous build.
    paths=[safe_file(root,name) for name in files]
    if destination.exists(): shutil.rmtree(destination)
    destination.mkdir()
    for source in paths:
        target=destination/source.relative_to(root);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    (destination/'.nojekyll').touch();errors=[]
    for page in destination.rglob('*.html'):
        def version_asset(match):
            url=urlsplit(match['path']);asset=(page.parent/unquote(url.path)).resolve()
            if url.scheme or url.netloc or destination not in asset.parents or not asset.is_file(): return match[0]
            return match['prefix']+match['path']+'?v='+hashlib.sha256(asset.read_bytes()).hexdigest()[:12]+match['end']
        html=re.sub(r'''(?P<prefix>\b(?:src|href)=["'])(?P<path>[^"'?]+\.(?:js|css))(?:\?[^"']*)?(?P<end>["'])''',version_asset,page.read_text());page.write_text(html)
        parser=Links();parser.feed(html)
        for value in parser.links:
            url=urlsplit(value)
            if url.scheme or url.netloc or not url.path: continue
            target=(page.parent/unquote(url.path)).resolve()
            if url.path.startswith('/') or (destination not in target.parents and target!=destination): errors.append(f'{page.relative_to(destination)}: escaping project link {value}')
            elif not target.exists(): errors.append(f'{page.relative_to(destination)}: missing link {value}')
    if errors: raise ValueError('\n'.join(errors))
    return len(files)+1

if __name__=='__main__': print(f'Built {build(Path(__file__).resolve().parents[1])} reviewed public files.')
