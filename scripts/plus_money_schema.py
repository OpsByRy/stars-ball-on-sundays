"""Public presentation records for privately selected parlay combinations."""
from pathlib import Path
import hashlib
import json
import re
from math import prod
from public_schema import keys,day,stamp,text,number,validate_edition

FIT_REASONS={
    'Algorithm-selected value legs.',
    'Different games limit shared rotation exposure.',
    'Each player appears once, with one exact stat line.',
    'Recent role, minutes and opportunity reviewed.',
    'All saved leg prices are from the same sportsbook.',
}
def canonical(body):return json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()

def validate(body):
    fields={'schemaVersion','date','firstPublishedAt','updatedAt','quoteObservedAt','priceNote','tickets','version'}
    keys(body,fields,fields)
    if body['schemaVersion']!='public-plus-money-1':raise ValueError('Invalid parlay publication')
    day(body['date']);stamp(body['firstPublishedAt']);stamp(body['updatedAt']);stamp(body['quoteObservedAt']);text(body['priceNote'])
    if not re.fullmatch('[0-9a-f]{16}',body['version']):raise ValueError('Invalid parlay version')
    if not isinstance(body['tickets'],list) or len(body['tickets'])>12:raise ValueError('Invalid parlay card count')
    ids=set()
    for ticket in body['tickets']:
        fields={'id','book','legs','indicativeAmericanOdds','priceKind','fitReasons','status'}
        keys(ticket,fields,fields);text(ticket['id'],100)
        if ticket['id'] in ids:raise ValueError('Duplicate parlay')
        ids.add(ticket['id'])
        if ticket['book'] not in {'fanduel','draftkings'} or ticket['priceKind']!='indicative' or ticket['status']!='provisional':raise ValueError('Unsupported parlay price or status')
        if not number(ticket['indicativeAmericanOdds']) or ticket['indicativeAmericanOdds']<100:raise ValueError('Not a plus-money reference')
        if not isinstance(ticket['fitReasons'],list) or not ticket['fitReasons'] or any(s not in FIT_REASONS for s in ticket['fitReasons']):raise ValueError('Unknown public fit statement')
        legs=ticket['legs']
        if not isinstance(legs,list) or not 2<=len(legs)<=3:raise ValueError('Invalid parlay length')
        validate_edition({'schemaVersion':'public-1','channel':'daily','date':body['date'],'timezone':'America/New_York','props':legs})
        games={r.get('canonicalEventId') or r.get('eventId') for r in legs};players={r.get('playerId') for r in legs}
        if len(games)!=len(legs) or None in games or len(players)!=len(legs) or None in players:raise ValueError('Published references require distinct games and players')
        if any(r.get('book')!=ticket['book'] for r in legs):raise ValueError('Mixed sportsbook parlay')
        if any(not number(r.get('americanOdds')) or abs(r['americanOdds'])<100 for r in legs):raise ValueError('Missing parlay leg price')
        decimal=prod(1+(r['americanOdds']/100 if r['americanOdds']>0 else 100/abs(r['americanOdds'])) for r in legs)
        if decimal<2 or abs(round((decimal-1)*100)-ticket['indicativeAmericanOdds'])>1:raise ValueError('Indicative parlay price mismatch')
        if any(r.get('group')!='research' or r.get('category') not in {'value_safe','high_probability_aggressive'} for r in legs):raise ValueError('Parlay contains a passed or personal pick')
    if hashlib.sha256(canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]!=body['version']:raise ValueError('Parlay digest mismatch')

def publication_files(root,safe_file):
    index_path='data/plus-money/manifest.json'
    if not (root/index_path).exists():return []
    index=json.loads(safe_file(root,index_path).read_text());keys(index,{'schemaVersion','editions'},{'schemaVersion','editions'})
    if index['schemaVersion']!='public-plus-money-manifest-1' or not isinstance(index['editions'],list):raise ValueError('Invalid parlay manifest')
    files=[index_path];seen=set()
    for entry in index['editions']:
        keys(entry,{'date','version','path','updatedAt','count'},{'date','version','path','updatedAt','count'})
        day(entry['date']);stamp(entry['updatedAt'])
        if not re.fullmatch('[0-9a-f]{16}',entry['version']) or entry['path']!=f"{entry['date']}/{entry['version']}.json":raise ValueError('Invalid parlay path')
        if entry['path'] in seen:raise ValueError('Duplicate parlay version')
        seen.add(entry['path']);name='data/plus-money/'+entry['path']
        body=json.loads(safe_file(root,name).read_text());validate(body)
        if any(body[k]!=entry[k] for k in ['date','version','updatedAt']) or len(body['tickets'])!=entry['count']:raise ValueError('Parlay manifest mismatch')
        files.append(name)
    return files
