"""Public presentation records for privately selected parlay combinations."""
from pathlib import Path
import hashlib
import json
import re
from math import prod
from datetime import datetime
from public_schema import keys,day,stamp,text,number,validate_edition

COMMON_FIT_REASONS={
    'Algorithm-selected value legs.',
    'Different games limit shared rotation exposure.',
    'Recent role, minutes and opportunity reviewed.',
}
SAME_BOOK_REASON='All saved leg prices are from the same sportsbook.'
MIXED_BOOK_REASON='Saved leg prices come from different sportsbooks; confirm the full ticket at your book.'
FIT_REASONS=COMMON_FIT_REASONS|{SAME_BOOK_REASON,MIXED_BOOK_REASON,'Each player appears once, with one exact stat line.'}
def canonical(body):return json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()

def validate_model_targets(targets,date):
    if not isinstance(targets,list) or len(targets)>12:raise ValueError('Invalid SGP model targets')
    seen=set()
    for target in targets:
        required={'id','legs','status','priceKind','compatibility','jointEstimate'}
        keys(target,required|{'ryFavorite'},required);text(target['id'],100);text(target['compatibility'])
        if target['id'] in seen:raise ValueError('Duplicate SGP model target')
        seen.add(target['id'])
        if target['status']!='provisional' or target['priceKind']!='model_target':raise ValueError('SGP target cannot claim an offered price')
        if 'ryFavorite' in target and type(target['ryFavorite']) is not bool:raise ValueError('Invalid model favorite')
        legs=target['legs']
        if not isinstance(legs,list) or not 2<=len(legs)<=3:raise ValueError('Invalid SGP model length')
        validate_edition({'schemaVersion':'public-1','channel':'daily','date':date,'timezone':'America/New_York','props':legs})
        games={r.get('canonicalEventId') or r.get('eventId') for r in legs}
        if len(games)!=1 or None in games:raise ValueError('SGP model target requires one exact game')
        families={(r.get('playerId'),r['market']) for r in legs}
        if len(families)!=len(legs) or any(not r.get('playerId') for r in legs):raise ValueError('Duplicate SGP stat family')
        for leg in legs:
            p=leg.get('estimate',{})
            if not number(p.get('winProbability')) or p.get('pushProbability')!=0:raise ValueError('SGP model requires modeled no-push legs')
        estimate=target['jointEstimate']
        fields={'asOf','winProbability','pushProbability','lossProbability','fairAmericanOdds','minimumAmericanOdds',
                'lowerProbability','upperProbability','sampleGames','calibrationNote'}
        keys(estimate,fields,fields);stamp(estimate['asOf']);text(estimate['calibrationNote'],300)
        p=estimate['winProbability']
        if not number(p) or not 0<p<1 or estimate['pushProbability']!=0 or not number(estimate['lossProbability']) or abs(p+estimate['lossProbability']-1)>1e-7:raise ValueError('Invalid joint model probabilities')
        marginal=[r['estimate']['winProbability'] for r in legs]
        if p>min(marginal)+1e-7 or p<max(0,sum(marginal)-len(marginal)+1)-1e-7:raise ValueError('Joint probability violates marginal bounds')
        lo,hi=estimate['lowerProbability'],estimate['upperProbability']
        if not number(lo) or not number(hi) or not 0<=lo<=hi<=1:raise ValueError('Invalid joint uncertainty interval')
        if type(estimate['sampleGames']) is not int or estimate['sampleGames']<1:raise ValueError('Invalid paired support')
        for key in ['fairAmericanOdds','minimumAmericanOdds']:
            if not number(estimate[key]) or abs(estimate[key])<100:raise ValueError('Invalid model target odds')
        odds=estimate['fairAmericanOdds'];decimal=1+(odds/100 if odds>0 else 100/abs(odds))
        if abs(1/decimal-p)>.002:raise ValueError('Fair model odds differ from joint probability')
        if estimate['minimumAmericanOdds']<odds:raise ValueError('Target price cannot be worse than model fair odds')
        if date>='2026-10-30' and estimate['minimumAmericanOdds']< -110:raise ValueError('SGP target final-price floor is -110')
        for leg in legs:
            if not leg.get('startTime') or not estimate['asOf'] or datetime.fromisoformat(estimate['asOf'].replace('Z','+00:00'))>=datetime.fromisoformat(leg['startTime'].replace('Z','+00:00')):raise ValueError('SGP estimate must be pregame')

def validate(body):
    fields={'schemaVersion','date','firstPublishedAt','updatedAt','quoteObservedAt','priceNote','tickets','version'}
    keys(body,fields|{'modelTargets'},fields)
    if body['schemaVersion'] not in {'public-plus-money-1','public-plus-money-2'}:raise ValueError('Invalid parlay publication')
    legacy=body['schemaVersion']=='public-plus-money-1'
    current=not legacy and body['date']>='2026-10-30'
    day(body['date']);stamp(body['firstPublishedAt']);stamp(body['updatedAt']);stamp(body['quoteObservedAt']);text(body['priceNote'])
    if 'modelTargets' in body:
        if legacy:raise ValueError('Legacy publication cannot add SGP targets')
        validate_model_targets(body['modelTargets'],body['date'])
    if not re.fullmatch('[0-9a-f]{16}',body['version']):raise ValueError('Invalid parlay version')
    if not isinstance(body['tickets'],list) or len(body['tickets'])>(12 if legacy else 48 if current else 24):raise ValueError('Invalid parlay card count')
    ids=set();tier_counts={}
    for ticket in body['tickets']:
        fields={'id','book','legs','indicativeAmericanOdds','priceKind','fitReasons','status'}
        if not legacy:fields.add('section')
        keys(ticket,fields|{'ryFavorite','selectedAt','postedAt'},fields);text(ticket['id'],100)
        if 'selectedAt' in ticket or 'postedAt' in ticket:
            if not ticket.get('selectedAt') or 'postedAt' not in ticket:raise ValueError('Ticket timing requires selection and posting fields')
            stamp(ticket['selectedAt']);stamp(ticket['postedAt'])
            selected=datetime.fromisoformat(ticket['selectedAt'].replace('Z','+00:00'))
            updated=datetime.fromisoformat(body['updatedAt'].replace('Z','+00:00'))
            if selected>updated:raise ValueError('Ticket selection cannot follow its edition')
            if ticket['postedAt'] is not None:
                posted=datetime.fromisoformat(ticket['postedAt'].replace('Z','+00:00'))
                if not selected<=posted<=updated:raise ValueError('Invalid ticket posting order')
            for leg in ticket['legs']:
                if not leg.get('startTime') or selected>=datetime.fromisoformat(leg['startTime'].replace('Z','+00:00')):raise ValueError('New ticket selection must be pregame')
        if 'ryFavorite' in ticket and type(ticket['ryFavorite']) is not bool:raise ValueError('Invalid Ry favorite flag')
        if ticket['id'] in ids:raise ValueError('Duplicate parlay')
        ids.add(ticket['id'])
        if ticket['book'] not in ({'fanduel','draftkings'} if legacy else {'fanduel','draftkings','mixed'}) or ticket['priceKind']!='indicative' or ticket['status']!='provisional':raise ValueError('Unsupported parlay price or status')
        ref=ticket['indicativeAmericanOdds']
        if not number(ref) or abs(ref)<100 or ref<(-110 if current else 100):raise ValueError('Outside supported parlay price floor')
        if current:
            tier='layups' if ref<=200 else 'mid_range' if ref<500 else 'longshots' if ref<1000 else 'logo_lottos'
            tier_counts[tier]=tier_counts.get(tier,0)+1
            if tier_counts[tier]>12:raise ValueError('Too many references in one prospective price tier')
        if not isinstance(ticket['fitReasons'],list) or not ticket['fitReasons'] or any(s not in FIT_REASONS for s in ticket['fitReasons']):raise ValueError('Unknown public fit statement')
        legs=ticket['legs']
        if not isinstance(legs,list) or not 2<=len(legs)<=(3 if legacy else 6):raise ValueError('Invalid parlay length')
        if not legacy:
            if ticket['section'] not in {'plus_money','longshots'}:raise ValueError('Unknown parlay section')
            if ticket['section']=='plus_money' and (len(legs)>3 or ticket['indicativeAmericanOdds']>=400):raise ValueError('Invalid plus-money section')
            if ticket['section']=='longshots' and (len(legs)<3 or ticket['indicativeAmericanOdds']<400):raise ValueError('Invalid longshot section')
        validate_edition({'schemaVersion':'public-1','channel':'daily','date':body['date'],'timezone':'America/New_York','props':legs})
        games={r.get('canonicalEventId') or r.get('eventId') for r in legs};players={r.get('playerId') for r in legs}
        if len(games)!=len(legs) or None in games or len(players)!=len(legs) or None in players:raise ValueError('Published references require distinct games and players')
        books={r.get('book') for r in legs}
        if not books<={'fanduel','draftkings'}:raise ValueError('Unsupported leg sportsbook')
        expected=next(iter(books)) if len(books)==1 else 'mixed'
        if ticket['book']!=expected or (legacy and len(books)!=1):raise ValueError('Mixed sportsbook attribution mismatch')
        if SAME_BOOK_REASON in ticket['fitReasons'] and len(books)!=1:raise ValueError('Incorrect same-book fit statement')
        if MIXED_BOOK_REASON in ticket['fitReasons'] and len(books)==1:raise ValueError('Incorrect mixed-book fit statement')
        if any(not number(r.get('americanOdds')) or abs(r['americanOdds'])<100 for r in legs):raise ValueError('Missing parlay leg price')
        decimal=prod(1+(r['americanOdds']/100 if r['americanOdds']>0 else 100/abs(r['americanOdds'])) for r in legs)
        expected_price=round((decimal-1)*100 if decimal>=2 else -100/(decimal-1))
        if decimal<(1+100/110 if current else 2)-1e-9 or abs(expected_price-ticket['indicativeAmericanOdds'])>1:raise ValueError('Indicative parlay price mismatch')
        if any(r.get('group')!='research' or r.get('category') not in {'value_safe','high_probability_aggressive'} for r in legs):raise ValueError('Parlay contains a passed or personal pick')
    if hashlib.sha256(canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]!=body['version']:raise ValueError('Parlay digest mismatch')

def publication_files(root,safe_file):
    index_path='data/plus-money/manifest.json'
    if not (root/index_path).exists():return []
    index=json.loads(safe_file(root,index_path).read_text());keys(index,{'schemaVersion','editions'},{'schemaVersion','editions'})
    if index['schemaVersion']!='public-plus-money-manifest-1' or not isinstance(index['editions'],list):raise ValueError('Invalid parlay manifest')
    files=[index_path];seen=set();latest_updates={};posting_clocks={};ticket_clocks={}
    for entry in index['editions']:
        keys(entry,{'date','version','path','updatedAt','count'},{'date','version','path','updatedAt','count'})
        day(entry['date']);stamp(entry['updatedAt'])
        if not re.fullmatch('[0-9a-f]{16}',entry['version']) or entry['path']!=f"{entry['date']}/{entry['version']}.json":raise ValueError('Invalid parlay path')
        if entry['path'] in seen:raise ValueError('Duplicate parlay version')
        seen.add(entry['path']);name='data/plus-money/'+entry['path']
        body=json.loads(safe_file(root,name).read_text());validate(body)
        if any(body[k]!=entry[k] for k in ['date','version','updatedAt']) or len(body['tickets'])!=entry['count']:raise ValueError('Parlay manifest mismatch')
        instant=datetime.fromisoformat(body['updatedAt'].replace('Z','+00:00'))
        if body['date'] in latest_updates and instant<latest_updates[body['date']]:raise ValueError('Parlay history must be chronological within each date')
        latest_updates[body['date']]=instant
        first=body['firstPublishedAt']
        first=datetime.fromisoformat(first.replace('Z','+00:00')) if first is not None else None
        if body['date'] in posting_clocks and first!=posting_clocks[body['date']]:raise ValueError('Verified parlay first-publication clock cannot change or be cleared')
        if first is not None:posting_clocks[body['date']]=first
        for ticket in body['tickets']:
            key=(body['date'],ticket['id'])
            if 'selectedAt' not in ticket:
                if key in ticket_clocks:raise ValueError('Verified ticket clocks cannot change or be cleared')
                continue
            selected=datetime.fromisoformat(ticket['selectedAt'].replace('Z','+00:00'))
            posted=datetime.fromisoformat(ticket['postedAt'].replace('Z','+00:00')) if ticket['postedAt'] else None
            if key in ticket_clocks:
                prior_selected,prior_posted=ticket_clocks[key]
                if selected!=prior_selected or prior_posted is not None and posted!=prior_posted:raise ValueError('Verified ticket clocks cannot change or be cleared')
            ticket_clocks[key]=(selected,posted)
        files.append(name)
    return files
