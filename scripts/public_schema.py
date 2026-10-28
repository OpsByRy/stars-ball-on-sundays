"""The complete public-data contract. Unknown fields fail closed at every level."""
from datetime import date, datetime
import math
import re

EDITION_FIELDS={'schemaVersion','channel','date','timezone','firstPublishedAt','recordedAt','updatedAt','priceNote','props','version','sharedBetslipUrl','favoritesPostedAt','sharedBetslipOdds'}
PICK_FIELDS={'id','date','player','playerId','eventId','canonicalEventId','team','opponent','matchup','startTime','period','product','market','side','operator','line','lineType','americanOdds','book','overtime','group','capturedAt','sourceType','evidence','result','resultSource','estimate','category','assessment','priceCheck','postedAt','ryFavorite'}
ESTIMATE_FIELDS={'projection','winProbability','pushProbability','lossProbability','asOf','status'}
RESULT_FIELDS={'actual','minutesPlayed','checkedAt','eventStatus','statisticalOutcome','sportsbookSettlement','source'}
SOURCE_FIELDS={'eventId','athleteId','expectedTeam','provider'}
TARGET_FIELDS={'date','eventId','playerId','espnEventId','espnAthleteId','expectedTeam'}
ENTRY_FIELDS={'channel','date','version','path','count','researchCount','updatedAt'}
MARKETS={'PTS','AST','REB','3PM','PRA','PR','PA','RA'}

def keys(obj, allowed, required=()):
    if not isinstance(obj,dict) or set(obj)-allowed or set(required)-set(obj):
        raise ValueError('Public schema contains unknown or missing fields')

def day(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):
        raise ValueError('Invalid date')
    date.fromisoformat(value)

def stamp(value):
    if value is not None:
        if not isinstance(value,str): raise ValueError('Invalid timestamp')
        parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
        if parsed.tzinfo is None: raise ValueError('Timestamp requires timezone')

def number(value):
    return type(value) in (int,float) and math.isfinite(value)

def text(value, maximum=500):
    if not isinstance(value,str) or len(value)>maximum or any(ord(c)<32 for c in value):
        raise ValueError('Invalid public text')

def validate_edition(body):
    keys(body,EDITION_FIELDS,{'schemaVersion','channel','date','props'})
    if body['schemaVersion']!='public-1' or body['channel'] not in {'daily','sunday'}: raise ValueError('Invalid edition')
    day(body['date'])
    for key in ('firstPublishedAt','recordedAt','updatedAt','favoritesPostedAt'): stamp(body.get(key))
    if body.get('timezone')!='America/New_York': raise ValueError('Invalid timezone')
    text(body.get('priceNote',''))
    if body.get('sharedBetslipUrl') is not None and not re.fullmatch(r'https://sportsbook\.fanduel\.com/addToBetslip\?shareCode=[a-zA-Z0-9]{1,64}',body['sharedBetslipUrl']): raise ValueError('Invalid shared slip URL')
    if body.get('sharedBetslipOdds') is not None and (not body.get('sharedBetslipUrl') or not number(body['sharedBetslipOdds']) or abs(body['sharedBetslipOdds'])<100): raise ValueError('Invalid shared slip price')
    if not isinstance(body['props'],list): raise ValueError('Invalid picks')
    seen=set()
    for row in body['props']:
        keys(row,PICK_FIELDS,{'id','date','player','market','operator','line','group'})
        if row['id'] in seen: raise ValueError('Duplicate pick')
        seen.add(row['id']);day(row['date'])
        if row['date']!=body['date'] or row['group'] not in {'ry','research'}: raise ValueError('Pick edition mismatch')
        if 'category' in row and (row['group']!='research' or row['category'] not in {'value_safe','high_probability_aggressive','not_a_pick'}): raise ValueError('Invalid published category')
        if row['market'] not in MARKETS or row['operator'] not in {'>','<','>=','<=','gt','lt','gte','lte'} or not number(row['line']) or row['line']<0: raise ValueError('Invalid exact contract')
        if row.get('americanOdds') is not None and (not number(row['americanOdds']) or abs(row['americanOdds'])<100): raise ValueError('Invalid price')
        if row.get('overtime') not in {None,True,False}: raise ValueError('Invalid overtime terms')
        if 'ryFavorite' in row and type(row['ryFavorite']) is not bool: raise ValueError('Invalid Ry favorite flag')
        for key in ('capturedAt','startTime','postedAt'): stamp(row.get(key))
        for key,value in row.items():
            if key not in {'line','americanOdds','overtime','result','resultSource','estimate','priceCheck','ryFavorite'} and value is not None: text(value)
        if 'priceCheck' in row:
            check=row['priceCheck'];keys(check,{'status','americanOdds','sourceAsOf','checkedAt','reviewedAmericanOdds','qualification'},{'status','checkedAt'})
            if check['status'] not in {'returned','not_returned'}: raise ValueError('Invalid quote check status')
            price=check.get('americanOdds')
            if check['status']=='returned' and (not number(price) or abs(price)<100): raise ValueError('Invalid checked price')
            if check['status']=='not_returned' and price is not None: raise ValueError('Unavailable checked price must be empty')
            if 'reviewedAmericanOdds' in check and (not number(check['reviewedAmericanOdds']) or abs(check['reviewedAmericanOdds'])<100): raise ValueError('Invalid reviewed price')
            if check.get('qualification') not in {None,'qualifies','does_not_qualify','unavailable'}: raise ValueError('Invalid price qualification')
            stamp(check.get('checkedAt'));stamp(check.get('sourceAsOf'))
        if 'estimate' in row:
            estimate=row['estimate'];keys(estimate,ESTIMATE_FIELDS,{'status'})
            if estimate['status'] not in {'provisional','validated'}: raise ValueError('Invalid estimate status')
            if 'projection' not in estimate and 'winProbability' not in estimate: raise ValueError('Empty estimate')
            if 'projection' in estimate and (not number(estimate['projection']) or estimate['projection']<0): raise ValueError('Invalid projection')
            probabilities={'winProbability','pushProbability','lossProbability'}
            if probabilities&set(estimate):
                if not probabilities<=set(estimate) or any(not number(estimate[k]) or not 0<=estimate[k]<=1 for k in probabilities) or abs(sum(estimate[k] for k in probabilities)-1)>1e-7: raise ValueError('Invalid outcome probabilities')
            stamp(estimate.get('asOf'))
        if 'resultSource' in row:
            source=row['resultSource'];keys(source,SOURCE_FIELDS,{'eventId','athleteId'})
            for key,value in source.items(): text(value)
            if not re.fullmatch(r'\d+',source['eventId']) or not re.fullmatch(r'\d+',source['athleteId']): raise ValueError('Invalid result identity')
            if source.get('provider','espn')!='espn': raise ValueError('Unsupported result provider')
        if 'result' in row:
            result=row['result'];keys(result,RESULT_FIELDS,{'eventStatus','statisticalOutcome'})
            if result.get('actual') is not None and (not number(result['actual']) or result['actual']<0): raise ValueError('Invalid actual')
            if result.get('minutesPlayed') is not None and (not number(result['minutesPlayed']) or not 0<=result['minutesPlayed']<=1440): raise ValueError('Invalid minutes played')
            if result['eventStatus'] not in {'scheduled','live','final','postponed','canceled','unknown'}: raise ValueError('Invalid game status')
            if result['statisticalOutcome'] not in {'win','loss','push','dnp','canceled','postponed','pending','unavailable','reached','not_reached'}: raise ValueError('Invalid outcome')
            if result['statisticalOutcome'] in {'win','loss','push'} and (result['eventStatus']!='final' or result.get('actual') is None): raise ValueError('Final outcome requires final stats')
            if result.get('sportsbookSettlement') not in {None,'unverified'}: raise ValueError('Statistical results cannot verify settlement')
            stamp(result.get('checkedAt'))
            if result.get('source') and not re.fullmatch(r'https://www\.espn\.com/nba/boxscore/_/gameId/\d+',result['source']): raise ValueError('Unsupported result URL')
    return body

def validate_manifest(body):
    keys(body,{'schemaVersion','editions'},{'schemaVersion','editions'})
    if body['schemaVersion']!='public-1' or not isinstance(body['editions'],list): raise ValueError('Invalid manifest')
    for row in body['editions']:
        keys(row,ENTRY_FIELDS,ENTRY_FIELDS);day(row['date']);stamp(row['updatedAt'])
        if row['channel'] not in {'daily','sunday'} or not re.fullmatch(r'[0-9a-f]{16}',row['version']): raise ValueError('Invalid manifest entry')
        if row['path']!=f"{row['channel']}/{row['date']}/{row['version']}.json": raise ValueError('Invalid edition path')
        if any(type(row[k]) is not int or row[k]<0 for k in ('count','researchCount')): raise ValueError('Invalid count')

def validate_targets(body):
    keys(body,{'schemaVersion','targets'},{'schemaVersion','targets'})
    if body['schemaVersion']!='public-1' or not isinstance(body['targets'],list): raise ValueError('Invalid stat targets')
    for row in body['targets']:
        keys(row,TARGET_FIELDS,{'date','eventId','playerId','espnEventId','espnAthleteId'});day(row['date'])
        for value in row.values(): text(value)
        if not all(re.fullmatch(r'\d+',row[k]) for k in ('espnEventId','espnAthleteId')): raise ValueError('Invalid public source IDs')
