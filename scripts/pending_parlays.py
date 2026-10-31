"""Keep first publication of new parlay additions before every leg's tip."""
from datetime import datetime,timezone
import hashlib,json,re
from build import safe_file,canonical

def verify_pending_parlays(root,now=None):
    if not (root/'pending-parlays.json').exists():return 'no unverified parlay additions'
    p=json.loads(safe_file(root,'pending-parlays.json').read_text())
    if set(p)!={'schemaVersion','date','editionVersion','ticketIds'} or p['schemaVersion']!='sbos-pending-pregame-parlays-1':raise ValueError('Invalid pending parlay marker')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',p['date']) or not re.fullmatch('[0-9a-f]{16}',p['editionVersion']):raise ValueError('Invalid pending parlay identity')
    ids=p['ticketIds']
    if not isinstance(ids,list) or not ids or len(set(ids))!=len(ids) or any(not isinstance(i,str) or not re.fullmatch('[0-9a-f]{16}',i) for i in ids):raise ValueError('Invalid pending ticket IDs')
    index=json.loads(safe_file(root,'data/plus-money/manifest.json').read_text());matches=[(n,e) for n,e in enumerate(index['editions']) if e['date']==p['date'] and e['version']==p['editionVersion']]
    if len(matches)!=1:raise ValueError('Pending parlay edition missing')
    position,entry=matches[0];expected=f"{p['date']}/{p['editionVersion']}.json"
    if entry['path']!=expected:raise ValueError('Invalid pending parlay path')
    body=json.loads(safe_file(root,'data/plus-money/'+expected).read_text())
    if body['version']!=p['editionVersion'] or hashlib.sha256(canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]!=p['editionVersion']:raise ValueError('Pending parlay digest mismatch')
    prior=set()
    for old in index['editions'][:position]:
        if old['date']==p['date']:prior.update(t['id'] for t in json.loads(safe_file(root,'data/plus-money/'+old['path']).read_text())['tickets'])
    tickets={t['id']:t for t in body['tickets']};now=now or datetime.now(timezone.utc)
    if now.utcoffset() is None:raise ValueError('Current time requires timezone')
    for identity in ids:
        ticket=tickets.get(identity)
        if not ticket or identity in prior or not ticket.get('selectedAt') or ticket.get('postedAt') is not None:raise ValueError('Pending marker requires new unposted tickets')
        for leg in ticket['legs']:
            if now>=datetime.fromisoformat(leg['startTime'].replace('Z','+00:00')):raise ValueError('New parlay cannot first publish at or after a leg tip')
    return f'{len(ids)} new parlay additions remain pregame; quote age alone is not a deadline'
