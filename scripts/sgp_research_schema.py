"""Narrow public SGP research observations; no qualification or financial data."""
from datetime import datetime, timezone
from pathlib import Path
from math import prod, floor, isclose, isfinite
import hashlib
import json
import re

from public_schema import validate_edition, day

BODY = {'schemaVersion','date','version','sourceDaily','sourceSelectionAt','nominatedAt','assembledAt','postedAt','suggestions'}
PICK = {'id','date','player','playerId','eventId','canonicalEventId','team','opponent','matchup','startTime','period','product','market','side','operator','line','lineType','americanOdds','book','overtime','group','capturedAt','sourceType','evidence','result','resultSource','estimate','category','assessment','postedAt','ryFavorite','selected'}
IDEA = {'id','recordKind','kind','priceSources','legs','combinedQuote','straightOddsBenchmark','compatibility','jointWinProbability','ticketEV','betReady','tracking'}
LEG = {'pick','providerAsOf','forecastCutoff','availability','role','settlementTerms'}
# Stats inside each market (same table as assets/sgp-math.js). One player may appear more than
# once on a ticket only with stats that do not overlap: 25+ points with 2+ made threes is fine;
# 15+ points with 20+ points, or points with points + assists, is not (Ry, 2026-11-10).
COMPONENTS = {'PTS':{'PTS'},'AST':{'AST'},'REB':{'REB'},'3PM':{'3PM'},'BLK':{'BLK'},'STL':{'STL'},
              'PRA':{'PTS','REB','AST'},'PA':{'PTS','AST'},'PR':{'PTS','REB'},'RA':{'REB','AST'}}


def overlapping_same_player(picks):
    """True when one player has two legs whose stats overlap (same stat, or a combo containing it)."""
    for i, a in enumerate(picks):
        for b in picks[i + 1:]:
            if a['playerId'] == b['playerId'] and COMPONENTS.get(a['market'], {a['market']}) & COMPONENTS.get(b['market'], {b['market']}):
                return True
    return False

def require(ok, message):
    if not ok:
        raise ValueError(message)

def keys(value, expected):
    require(type(value) is dict and set(value) == expected, 'Unexpected research fields')

def read(path):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate research JSON key')
            result[key] = value
        return result
    return json.loads(Path(path).read_bytes(), object_pairs_hook=pairs,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite research JSON')))

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()

def clock(value, now, physical=True):
    require(type(value) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)', value), 'Aware research clock required')
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(stamp.tzinfo is not None and (not physical or stamp <= now), 'Future research observation')
    return stamp

JOINT = {'status','reason','modelVersion','estimatedAt','inputCutoff','winProbability','pushProbability','lossProbability','fairAmericanOdds','sampleGames','limitations'}
def safe_text(value):
    return type(value) is str and 0 < len(value) <= 1200 and not re.search(r'[<>\x00-\x1f]', value)

def validate_joint(model, body, legs, now):
    keys(model, JOINT)
    require(model['status'] in ('experimental','unavailable'), 'Invalid joint model status')
    require(model['reason'] is None or safe_text(model['reason']), 'Invalid joint model reason')
    require(model['modelVersion'] is None or safe_text(model['modelVersion']), 'Invalid joint model version')
    cutoff, estimated = clock(model['inputCutoff'],now), clock(model['estimatedAt'],now)
    require(cutoff <= estimated <= clock(body['assembledAt'],now) and cutoff < min(clock(l['pick']['startTime'],now,False) for l in legs), 'Invalid joint model clock order')
    require(type(model['limitations']) is list and 1 <= len(model['limitations']) <= 32 and all(safe_text(x) for x in model['limitations']), 'Explicit joint model limitations required')
    numbers = ('winProbability','pushProbability','lossProbability','fairAmericanOdds','sampleGames')
    if model['status'] == 'unavailable':
        require(safe_text(model['reason']) and all(model[k] is None for k in numbers), 'Unavailable model requires reason and null numbers')
        return
    require(safe_text(model['modelVersion']) and model['reason'] is None, 'Experimental model version required')
    probabilities = [model[k] for k in numbers[:3]]
    require(all(type(x) in (int,float) and isfinite(x) and 0 <= x <= 1 for x in probabilities) and abs(sum(probabilities)-1) < 1e-7, 'Invalid joint model probabilities')
    require(type(model['sampleGames']) is int and 1 <= model['sampleGames'] <= 2**53-1, 'Invalid joint model sample count')
    win, push, loss = probabilities
    if push > 0 or win in (0,1):
        require(model['fairAmericanOdds'] is None, 'No finite fair price with pushes or boundary probability')
    else:
        decimal = 1/win
        fair = (decimal-1)*100 if decimal >= 2 else -100/(decimal-1)
        require(type(model['fairAmericanOdds']) is int and abs(model['fairAmericanOdds']) <= 2**53-1 and abs(model['fairAmericanOdds'] - fair) <= .500000001, 'Joint fair price does not reproduce')

def validate(body, *, source=None, calculator_sha=None, now=None):
    now = now or datetime.now(timezone.utc)
    keys(body, BODY)
    require(body['schemaVersion'] == 'public-sgp-research-1', 'Unsupported research version')
    day(body['date'])
    require(type(body['version']) is str and re.fullmatch('[0-9a-f]{16}', body['version']), 'Invalid research version')
    require(hashlib.sha256(canonical({k:v for k,v in body.items() if k != 'version'})).hexdigest()[:16] == body['version'], 'Research digest mismatch')
    keys(body['sourceDaily'], {'version','path'})
    s = body['sourceDaily']
    require(type(s['version']) is str and re.fullmatch('[0-9a-f]{16}', s['version']) and
        s['path'] == f"daily/{body['date']}/{s['version']}.json", 'Invalid original Daily path')
    selection, nomination, assembly = [clock(body[k], now) for k in ('sourceSelectionAt','nominatedAt','assembledAt')]
    require(selection <= nomination <= assembly, 'Research clock order')
    require(body['postedAt'] is None or nomination <= clock(body['postedAt'], now) <= assembly, 'Research posting clock')
    require(type(body['suggestions']) is list and len(body['suggestions']) <= 64, 'Bounded research collection required')
    originals = None
    if source is not None:
        validate_edition(source)
        require(source['date'] == body['date'] and source['version'] == s['version'], 'Original Daily mismatch')
        originals = {p['id']:p for p in source['props']}
    ids, memberships, copies = set(), set(), {}
    from zoneinfo import ZoneInfo
    for a in body['suggestions']:
        keys(a, IDEA | ({'jointModel'} if 'jointModel' in a else set()))
        if 'jointModel' in a:
            validate_joint(a['jointModel'], body, a['legs'], now)
        require(type(a['id']) is str and re.fullmatch('sgp-research-'+re.escape(body['date'])+'-[0-9a-f]{16}',a['id']) and a['id'] not in ids, 'Unique research ID required')
        ids.add(a['id'])
        require(a['recordKind'] == 'sgp_research_suggestion' and type(a['legs']) is list and 2 <= len(a['legs']) <= 6, 'Invalid research record')
        picks = []
        for leg in a['legs']:
            keys(leg, LEG); p = leg['pick']; keys(p, PICK)
            validate_edition({'schemaVersion':'public-1','channel':'daily','date':body['date'],'timezone':'America/New_York','props':[p]})
            require(p['date'] == body['date'] and p['eventId'] == p['canonicalEventId'] and p['group'] == 'research' and p['selected'] is True and p['ryFavorite'] is False, 'Invalid original pick')
            require(p['postedAt'] is None and p['overtime'] is None and p['sourceType'] == 'saved_sportsbook_quote_statistical_comparison', 'Unverified original facts changed')
            require(p['result'] == {'eventStatus':'scheduled','statisticalOutcome':'pending','sportsbookSettlement':'unverified'}, 'Original pending result changed')
            require(set(p['estimate']) == {'winProbability','pushProbability','lossProbability','projection','asOf','status'}, 'Saved estimate fields changed')
            require(p['estimate']['status'] == 'provisional', 'Research estimate cannot be promoted')
            require(clock(leg['providerAsOf'],now) <= clock(p['capturedAt'],now) <= selection, 'Original quote clock changed')
            require(clock(leg['forecastCutoff'],now) <= clock(p['estimate']['asOf'],now) <= selection, 'Original forecast clock changed')
            start = clock(p['startTime'], now, False)
            require(start.astimezone(ZoneInfo('America/New_York')).date().isoformat() == body['date'] and nomination < start, 'Exact original pregame identity required')
            require(leg['availability'] == 'unknown' and leg['role'] == 'unknown' and leg['settlementTerms'] == 'unverified', 'Unknown context changed')
            require(originals is None or originals.get(p['id']) == p, 'Research leg differs from immutable Daily source')
            require(p['id'] not in copies or copies[p['id']] == leg, 'Repeated leg has conflicting facts')
            copies[p['id']] = leg; picks.append(p)
        members = tuple(sorted(p['id'] for p in picks))
        require(len(set(members)) == len(members) and members not in memberships, 'Duplicate research membership')
        memberships.add(members)
        games = [p['eventId'] for p in picks]
        require(not overlapping_same_player(picks), 'The same player cannot repeat an overlapping stat')
        kind = 'sgp' if len(set(games)) == 1 else 'sgp_plus' if len(set(games)) < len(games) else None
        require(kind is not None and a['kind'] == kind, 'Research SGP grouping mismatch')
        books = {p['book'] for p in picks}
        require(a['priceSources'] == (next(iter(books)) if len(books) == 1 else 'mixed'), 'Mixed-book attribution mismatch')
        require(a['combinedQuote'] is None and a['jointWinProbability'] is None and a['ticketEV'] is None and a['betReady'] is False and a['tracking'] == 'hit_rate_only', 'Research cannot contain executable or financial assertions')
        require(a['compatibility'] == {'logicalChecks':'passed','metric':None,'selectionUse':'informational_only'}, 'No numerical compatibility evidence supplied')
        b = a['straightOddsBenchmark']
        if b is not None:
            keys(b, {'method','decimalOdds','americanOdds','calculatorSHA256'})
            require(b['method'] == 'unadjusted_straight_odds_product' and type(b['calculatorSHA256']) is str and re.fullmatch('[0-9a-f]{64}', b['calculatorSHA256']), 'Invalid benchmark method/version')
            require(calculator_sha is None or b['calculatorSHA256'] == calculator_sha, 'Calculator source version differs')
            decimal = prod(1+(p['americanOdds']/100 if p['americanOdds'] > 0 else 100/abs(p['americanOdds'])) for p in picks)
            american = floor(((decimal-1)*100 if decimal >= 2 else -100/(decimal-1))+.5)
            require(type(b['decimalOdds']) in (int,float) and isclose(b['decimalOdds'],decimal,rel_tol=1e-12) and
                type(b['americanOdds']) is int and abs(b['americanOdds']) <= 2**53-1 and b['americanOdds'] == american, 'Straight-odds benchmark does not reproduce')
    return body

def publication_files(root, safe_file):
    name = 'data/sgp-research/manifest.json'
    if not (root/name).exists():
        return []
    index = read(safe_file(root,name)); keys(index, {'schemaVersion','editions'})
    require(index['schemaVersion'] == 'public-sgp-research-index-1' and type(index['editions']) is list and len(index['editions']) <= 3660, 'Invalid research manifest')
    files, seen = [name], set()
    calculator_sha = hashlib.sha256(safe_file(root,'assets/sgp-math.js').read_bytes()).hexdigest()
    for e in index['editions']:
        keys(e, {'date','version','path','sha256','count','updatedAt'})
        require(type(e['date']) is str and re.fullmatch(r'\d{4}-\d\d-\d\d',e['date']) and type(e['version']) is str and re.fullmatch('[0-9a-f]{16}',e['version']) and e['path'] == e['date']+'/'+e['version']+'.json' and e['path'] not in seen, 'Unsafe or duplicate research path')
        seen.add(e['path']); path = 'data/sgp-research/'+e['path']; raw = safe_file(root,path).read_bytes()
        require(type(e['sha256']) is str and hashlib.sha256(raw).hexdigest() == e['sha256'], 'Research transport hash mismatch')
        b = read(safe_file(root,path)); validate(b, calculator_sha=calculator_sha)
        source = read(safe_file(root,'data/editions/'+b['sourceDaily']['path']))
        validate(b, source=source, calculator_sha=calculator_sha)
        require(e['date'] == b['date'] and e['version'] == b['version'] and type(e['count']) is int and e['count'] == len(b['suggestions']) and e['updatedAt'] == b['assembledAt'], 'Research manifest/body mismatch')
        files.append(path)
    return files
