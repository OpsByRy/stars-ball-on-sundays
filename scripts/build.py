"""Build the public website from an explicit file list and validated result records."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit
from public_schema import validate_edition, validate_manifest, validate_targets, validate_game_log_index, validate_game_log, validate_game_log_catalog
from plus_money_schema import publication_files as plus_money_files

from profile_schema import validate_profile,validate_profile_index
from career_schema import validate_career_history,validate_career_index

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

def board_views(root):
    """Small, derived views; the complete hash-verified editions stay unchanged.

    Keep personal rows as attribution evidence for equivalent favorite contracts.
    Passed research is fetched only on the separate Research page.
    """
    index=json.loads((root/'data/editions/manifest.json').read_text())
    latest={}
    for entry in index['editions']: latest[(entry['channel'],entry['date'])]=entry
    views={}
    for entry in latest.values():
        if entry['channel']!='daily': continue
        body=json.loads((root/'data/editions'/entry['path']).read_text())
        edition={key:value for key,value in body.items() if key!='version'}
        edition['props']=[p for p in body['props'] if p['group']=='ry' or p.get('category')!='not_a_pick']
        views['data/boards/'+entry['path']]={'schemaVersion':'public-board-1','sourceVersion':entry['version'],'edition':edition}
    return views

def profile_views(root):
    # Reuse only exact, already-reviewed proposition records; no research execution.
    if not (root/'data/player-profiles/index.json').exists():return {}
    directory=json.loads((root/'data/player-profiles/index.json').read_text());editions={};views={}
    for entry in directory['players']:
        body=json.loads((root/'data/player-profiles'/entry['path']).read_text());u=body.get('upcoming')
        if not u:continue
        if u['editionPath'] not in editions:editions[u['editionPath']]=json.loads((root/'data/editions'/u['editionPath']).read_text())
        edition=editions[u['editionPath']];ids=set(u['pickIds']+u['researchIds']+[m['referenceId'] for m in u['markets']])
        props=[p for p in edition['props'] if p['playerId']==body['playerId'] and (p['id'] in ids or p['group']=='ry')]
        views['data/profile-views/'+u['editionVersion']+'/'+body['playerId'].split(':')[1]+'.json']={'schemaVersion':'public-profile-view-1','version':u['editionVersion'],'playerId':body['playerId'],'date':u['date'],'props':props}
    return views

def game_log_files(root):
    if not (root/'data/player-logs/catalog.json').exists():return []
    catalog=json.loads(safe_file(root,'data/player-logs/catalog.json').read_text());validate_game_log_catalog(catalog)
    files=['data/player-logs/catalog.json','data/player-logs/index.json']
    for season in catalog['seasons']:
        index_name='data/player-logs/'+season['path'];index=json.loads(safe_file(root,index_name).read_text());validate_game_log_index(index)
        if any(index[k]!=season[k] for k in ('season','capturedAt','dataThrough','games','appearances')) or len(index['players'])!=season['players']:raise ValueError('Season coverage mismatch')
        files.append(index_name);events=set()
        for entry in index['players']:
            name='data/player-logs/'+entry['path'];body=json.loads(safe_file(root,name).read_text());validate_game_log(body)
            if body['playerId']!=entry['id'] or body['player']!=entry['name'] or body['season']!=index['season'] or body['version']!=entry['version'] or len(body['games'])!=entry['games']:raise ValueError('Game-log identity mismatch')
            if hashlib.sha256(canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]!=entry['version']:raise ValueError('Game-log digest mismatch')
            if max(g['date'] for g in body['games'])!=entry['lastGameDate'] or sorted({g['team'] for g in body['games']})!=entry['teams']:raise ValueError('Game-log coverage mismatch')
            events.update(g['eventId'] for g in body['games']);files.append(name)
        if len(events)!=index['games']:raise ValueError('League game count mismatch')
    newest=max(catalog['seasons'],key=lambda e:e['season'])
    if safe_file(root,'data/player-logs/index.json').read_bytes()!=safe_file(root,'data/player-logs/'+newest['path']).read_bytes():raise ValueError('Latest season alias mismatch')
    return files

def career_files(root):
    if not (root/'data/career-matchups/index.json').exists():return []
    index=json.loads(safe_file(root,'data/career-matchups/index.json').read_text());validate_career_index(index);files=['data/career-matchups/index.json']
    for entry in index['matchups']:
        name='data/career-matchups/'+entry['path'];body=json.loads(safe_file(root,name).read_text());validate_career_history(body)
        if body['playerId']!=entry['playerId'] or body['opponent']!=entry['opponent'] or body['version']!=entry['version'] or hashlib.sha256(canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]!=entry['version']:raise ValueError('Career history identity/digest mismatch')
        files.append(name)
    return files

def profile_files(root):
    if not (root/'data/player-profiles/index.json').exists():return []
    index=json.loads(safe_file(root,'data/player-profiles/index.json').read_text());validate_profile_index(index)
    files=['data/player-profiles/index.json'];editions={}
    for p in index['players']:
        name='data/player-profiles/'+p['path'];body=json.loads(safe_file(root,name).read_text());validate_profile(body)
        if body['playerId']!=p['id'] or body['player']!=p['name'] or body['asOfDate']!=index['asOfDate'] or body['version']!=p['version'] or hashlib.sha256(canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]!=p['version']:raise ValueError('Profile identity/digest mismatch')
        u=body.get('upcoming')
        if u:
            path=u['editionPath']
            if path not in editions:editions[path]=json.loads(safe_file(root,'data/editions/'+path).read_text())
            edition=editions[path];props={r['id']:r for r in edition['props']}
            if edition['version']!=u['editionVersion']:raise ValueError('Profile edition mismatch')
            for key in ('pickIds','researchIds'):
                for identifier in u[key]:
                    row=props.get(identifier,{})
                    if row.get('playerId')!=body['playerId'] or row.get('date')!=u['date'] or row.get('team')!=u['team'] or row.get('opponent')!=u['opponent'] or key=='pickIds' and row.get('category') not in {'value_safe','high_probability_aggressive'}:raise ValueError('Profile pick identity mismatch')
            h=u.get('opponentHistory')
            if h:
                history=json.loads(safe_file(root,'data/career-matchups/'+h['path']).read_text());validate_career_history(history)
                if history['playerId']!=body['playerId'] or history['opponent']!=u['opponentAbbreviation'] or history['version']!=h['version'] or len(history['games'])!=h['games'] or history['through']!=h['through'] or history['requestedFromSeason']!=h['fromSeason'] or history['missingSeasons']!=h['missingSeasons']:raise ValueError('Profile career-history reference mismatch')
                components={'PTS':['PTS'],'REB':['REB'],'AST':['AST'],'3PM':['3PM'],'BLK':['BLK'],'STL':['STL'],'PRA':['PTS','REB','AST'],'PR':['PTS','REB'],'PA':['PTS','AST'],'RA':['REB','AST'],'MIN':['MIN']}
                for stat,fields in components.items():
                    vals=[sum(g['stats'][k] for k in fields) for g in history['games'] if all(type(g['stats'].get(k)) in (int,float) for k in fields)];average=sum(vals)/len(vals) if vals else None
                    if h['averages'][stat]!=average:raise ValueError('Profile career average mismatch')
            for m in u['markets']:
                row=props.get(m['referenceId'],{})
                if row.get('playerId')!=body['playerId'] or row.get('market')!=m['market'] or row.get('estimate',{}).get('projection')!=m['projection']:raise ValueError('Profile projection mismatch')
        files.append(name)
    return files

def build(root):
    root=Path(root).resolve();destination=root/'dist'
    if destination.is_symlink(): raise ValueError('Destination cannot be a symlink')
    manifest=json.loads(safe_file(root,'site-manifest.json').read_text())
    if set(manifest)!={'files'} or not isinstance(manifest['files'],list): raise ValueError('Invalid site file list')
    files=manifest['files']+publication_files(root)+plus_money_files(root,safe_file)+game_log_files(root)+profile_files(root)+career_files(root)
    if len(set(files))!=len(files): raise ValueError('Duplicate public file')
    for name in manifest['files']:
        if name.startswith('data/') or not (name.endswith('.html') or name.startswith('assets/')): raise ValueError('Only reviewed pages and assets belong in site-manifest')
    # Validate everything before replacing the previous build.
    paths=[safe_file(root,name) for name in files]
    views={**board_views(root),**profile_views(root)}
    if destination.exists(): shutil.rmtree(destination)
    destination.mkdir()
    for source in paths:
        target=destination/source.relative_to(root);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    for name,view in views.items():
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(canonical(view))
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
    return len(files)+len(views)+1

if __name__=='__main__': print(f'Built {build(Path(__file__).resolve().parents[1])} reviewed public files.')
