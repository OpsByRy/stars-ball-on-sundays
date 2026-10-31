"""A game-start guard for not-yet-posted additions, independent of quote age."""
from datetime import datetime,timezone
import hashlib,json,re
from build import safe_file,canonical

def verify_pending_additions(root,now=None):
    marker=root/'pending-additions.json'
    if not marker.exists():return 'no unverified pregame additions'
    pending=json.loads(safe_file(root,'pending-additions.json').read_text())
    if set(pending)!={'schemaVersion','date','editionVersion','pickIds'} or pending['schemaVersion']!='sbos-pending-pregame-additions-1':raise ValueError('Invalid pending additions marker')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',pending['date']) or not re.fullmatch(r'[0-9a-f]{16}',pending['editionVersion']):raise ValueError('Invalid pending additions identity')
    ids=pending['pickIds']
    if not isinstance(ids,list) or not 1<=len(ids)<=128 or any(not isinstance(i,str) or not re.fullmatch('[0-9a-f]{64}',i) for i in ids) or len(set(ids))!=len(ids):raise ValueError('Invalid pending pick IDs')
    index=json.loads(safe_file(root,'data/editions/manifest.json').read_text())
    matches=[(n,e) for n,e in enumerate(index['editions']) if e['channel']=='daily' and e['date']==pending['date'] and e['version']==pending['editionVersion']]
    if len(matches)!=1:raise ValueError('Pending additions edition missing')
    position,entry=matches[0];expected=f"daily/{pending['date']}/{pending['editionVersion']}.json"
    if entry['path']!=expected:raise ValueError('Invalid pending edition path')
    body=json.loads(safe_file(root,'data/editions/'+expected).read_text())
    if body.get('version')!=pending['editionVersion'] or hashlib.sha256(canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]!=pending['editionVersion']:raise ValueError('Pending additions digest mismatch')
    rows={r['id']:r for r in body['props']};now=now or datetime.now(timezone.utc)
    if now.utcoffset() is None:raise ValueError('Current time requires timezone')
    earlier=set()
    for old in index['editions'][:position]:
        if old['channel']!='daily' or old['date']!=pending['date']:continue
        saved=json.loads(safe_file(root,'data/editions/'+old['path']).read_text())
        earlier.update(r['id'] for r in saved['props'] if r.get('category') in {'value_safe','high_probability_aggressive'})
    for identity in ids:
        row=rows.get(identity)
        if not row or identity in earlier or row.get('group')!='research' or row.get('category') not in {'value_safe','high_probability_aggressive'} or row.get('selected') is not True or row.get('postedAt') is not None:raise ValueError('Pending marker must identify only new unposted selections')
        start=datetime.fromisoformat(row['startTime'].replace('Z','+00:00'))
        if start.utcoffset() is None or now>=start:raise ValueError('New pregame additions cannot first publish at or after tip; retain the healthy site')
    return f'{len(ids)} new additions remain pregame; saved quote age is not a deadline'
