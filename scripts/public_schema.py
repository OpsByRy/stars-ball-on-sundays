"""The complete public-data contract. Unknown fields fail closed at every level."""
from datetime import date, datetime
import math
import re

EDITION_FIELDS={'schemaVersion','channel','date','timezone','firstPublishedAt','recordedAt','updatedAt','priceNote','props','version','sharedBetslipUrl','favoritesPostedAt','sharedBetslipOdds','personalSlips','personalPublication'}
PICK_FIELDS={'id','date','player','playerId','eventId','canonicalEventId','team','opponent','matchup','startTime','period','product','market','side','operator','line','lineType','americanOdds','book','overtime','group','capturedAt','sourceType','evidence','result','resultSource','estimate','category','assessment','priceCheck','postedAt','ryFavorite','selected','confidenceUpdate','bookPrices'}
ESTIMATE_FIELDS={'projection','winProbability','pushProbability','lossProbability','asOf','status'}
RESULT_FIELDS={'actual','minutesPlayed','checkedAt','eventStatus','statisticalOutcome','sportsbookSettlement','source'}
SOURCE_FIELDS={'eventId','athleteId','expectedTeam','provider'}
TARGET_FIELDS={'date','eventId','playerId','espnEventId','espnAthleteId','expectedTeam'}
ENTRY_FIELDS={'channel','date','version','path','count','researchCount','updatedAt'}
MARKETS={'PTS','AST','REB','3PM','PRA','PR','PA','RA','BLK','STL'}

def season_name(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}',value) or int(value[-2:])!=(int(value[:4])+1)%100: raise ValueError('Invalid season')

def validate_game_log_catalog(body):
    keys(body,{'schemaVersion','seasons'},{'schemaVersion','seasons'})
    if body['schemaVersion']!='public-game-log-catalog-1' or not isinstance(body['seasons'],list) or not 1<=len(body['seasons'])<=20:raise ValueError('Invalid game-log seasons')
    seen=set()
    for entry in body['seasons']:
        keys(entry,{'season','path','dataThrough','capturedAt','players','games','appearances'},{'season','path','dataThrough','capturedAt','players','games','appearances'})
        season_name(entry['season']);day(entry['dataThrough']);stamp(entry['capturedAt'])
        if entry['season'] in seen or entry['path']!=entry['season']+'/index.json':raise ValueError('Invalid season index path')
        seen.add(entry['season'])
        if any(type(entry[k]) is not int or entry[k]<0 for k in ('players','games','appearances')):raise ValueError('Invalid season coverage')

def validate_game_log_index(body):
    keys(body,{'schemaVersion','season','source','capturedAt','dataThrough','appearances','games','players'},{'schemaVersion','season','source','capturedAt','dataThrough','appearances','games','players'})
    if body['schemaVersion']!='public-game-logs-1' or body['source']!='nba':raise ValueError('Invalid game-log index')
    season_name(body['season']);stamp(body['capturedAt']);day(body['dataThrough'])
    if body['capturedAt'] is None:raise ValueError('Missing log capture time')
    if any(type(body[k]) is not int or body[k]<0 for k in ('appearances','games')):raise ValueError('Invalid log coverage')
    if not isinstance(body['players'],list) or len(body['players'])>2000:raise ValueError('Invalid player directory')
    ids=set();espn=set();total=0
    for player in body['players']:
        keys(player,{'id','nbaId','espnId','name','teams','latestTeam','games','lastGameDate','version','path'},{'id','nbaId','name','teams','latestTeam','games','lastGameDate','version','path'})
        if not isinstance(player['nbaId'],str) or not re.fullmatch(r'\d{1,12}',player['nbaId']) or player['id']!='nba:'+player['nbaId'] or player['id'] in ids:raise ValueError('Invalid player identity')
        ids.add(player['id']);text(player['name'],120)
        if 'espnId' in player:
            if not re.fullmatch(r'\d{1,12}',player['espnId']) or player['espnId'] in espn:raise ValueError('Ambiguous ESPN identity')
            espn.add(player['espnId'])
        if not isinstance(player['teams'],list) or not player['teams'] or any(not isinstance(t,str) or not re.fullmatch(r'[A-Z]{2,4}',t) for t in player['teams']) or player['latestTeam'] not in player['teams']:raise ValueError('Invalid player teams')
        if type(player['games']) is not int or not 1<=player['games']<=150:raise ValueError('Invalid appearance count')
        total+=player['games'];day(player['lastGameDate'])
        if player['lastGameDate']>body['dataThrough']:raise ValueError('Game outside log coverage')
        if not re.fullmatch(r'[0-9a-f]{16}',player['version']) or player['path']!=f"{body['season']}/{player['nbaId']}/{player['version']}.json":raise ValueError('Invalid game-log path')
    if total!=body['appearances']:raise ValueError('Appearance count mismatch')

def validate_game_log(body):
    keys(body,{'schemaVersion','season','playerId','player','games','version'},{'schemaVersion','season','playerId','player','games','version'})
    if body['schemaVersion']!='public-game-log-1' or not re.fullmatch(r'nba:\d{1,12}',body['playerId']):raise ValueError('Invalid game log')
    season_name(body['season']);text(body['player'],120)
    if not re.fullmatch(r'[0-9a-f]{16}',body['version']) or not isinstance(body['games'],list) or not 1<=len(body['games'])<=150:raise ValueError('Invalid log body')
    seen=set()
    for game in body['games']:
        keys(game,{'eventId','date','team','opponent','home','stats'},{'eventId','date','team','opponent','home','stats'})
        if not re.fullmatch(r'002'+body['season'][2:4]+r'\d{5}',game['eventId']) or game['eventId'] in seen:raise ValueError('Invalid or duplicate regular-season log event')
        seen.add(game['eventId']);day(game['date'])
        if any(not isinstance(game[k],str) or not re.fullmatch(r'[A-Z]{2,4}',game[k]) for k in ('team','opponent')) or type(game['home']) is not bool:raise ValueError('Invalid log matchup')
        keys(game['stats'],{'MIN','PTS','REB','AST','3PM','FGA','3PA','FTA','FGM','FG%','3P%','FTM','FT%','BLK','STL','TO'},{'MIN','PTS','REB','AST','3PM','FGA','3PA','FTA','FGM','FG%','3P%','FTM','FT%','BLK','STL','TO'})
        if any(value is not None and (not number(value) or not 0<=value<=1440) for value in game['stats'].values()):raise ValueError('Invalid box-score statistic')
        if any(value is not None and not float(value).is_integer() for key,value in game['stats'].items() if key not in {'MIN','FG%','3P%','FT%'}):raise ValueError('Invalid counting statistic')
        if any(game['stats'][k] is not None and not 0<=game['stats'][k]<=1 for k in ('FG%','3P%','FT%')):raise ValueError('Invalid shooting percentage')
        for made,attempted in [('FGM','FGA'),('3PM','3PA'),('FTM','FTA')]:
            if game['stats'][made] is not None and game['stats'][attempted] is not None and game['stats'][made]>game['stats'][attempted]:raise ValueError('Made shots exceed attempts')

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


def validate_estimate(estimate):
    keys(estimate,ESTIMATE_FIELDS,{'status'})
    if estimate['status'] not in {'provisional','validated'}:raise ValueError('Invalid estimate status')
    if 'projection' not in estimate and 'winProbability' not in estimate:raise ValueError('Empty estimate')
    if 'projection' in estimate and (not number(estimate['projection']) or estimate['projection']<0):raise ValueError('Invalid projection')
    probabilities={'winProbability','pushProbability','lossProbability'}
    if probabilities&set(estimate):
        if not probabilities<=set(estimate) or any(not number(estimate[k]) or not 0<=estimate[k]<=1 for k in probabilities) or abs(sum(estimate[k] for k in probabilities)-1)>1e-7:raise ValueError('Invalid outcome probabilities')
    stamp(estimate.get('asOf'))


def validate_confidence_update(update,row):
    keys(update,{'status','checkedAt','estimate','americanOdds','capturedAt','summary','qualification'},
         {'status','checkedAt','summary','qualification'})
    if update['status'] not in {'supported','reduced','improved','review','unavailable'}:raise ValueError('Invalid confidence update status')
    if update['qualification'] not in {'qualifies','does_not_qualify','unavailable'}:raise ValueError('Invalid confidence update qualification')
    stamp(update['checkedAt']);stamp(update.get('capturedAt'));text(update['summary'])
    if update['checkedAt'] is None or row.get('startTime') and datetime.fromisoformat(update['checkedAt'].replace('Z','+00:00'))>=datetime.fromisoformat(row['startTime'].replace('Z','+00:00')):raise ValueError('Confidence update must be pregame')
    if update.get('americanOdds') is not None and (not number(update['americanOdds']) or abs(update['americanOdds'])<100 or update.get('capturedAt') is None):raise ValueError('Invalid confidence update price')
    if update['qualification']=='qualifies' and (update.get('americanOdds') is None or 'estimate' not in update):raise ValueError('Qualifying update needs a price and estimate')
    if 'estimate' in update:
        validate_estimate(update['estimate'])
        if update['estimate'].get('asOf')!=update['checkedAt']:raise ValueError('Confidence estimate timestamp mismatch')

def price_outcome(row):
    op={'gte':'>=','lte':'<=','gt':'>','lt':'<'}.get(row['operator'],row['operator']);line=row['line']
    if op=='>=':return '>',math.ceil(line)-.5
    if op=='<=':return '<',math.floor(line)+.5
    if not float(line).is_integer():line=math.floor(line)+.5 if op=='>' else math.ceil(line)-.5
    return op,line

def validate_book_prices(prices,row):
    keys(prices,{'checkedAt','quotes'},{'checkedAt','quotes'});stamp(prices['checkedAt'])
    if prices['checkedAt'] is None or not isinstance(prices['quotes'],list) or len(prices['quotes'])>2:raise ValueError('Invalid book price coverage')
    seen=set()
    for quote in prices['quotes']:
        keys(quote,{'book','americanOdds','capturedAt','operator','line'},{'book','americanOdds','capturedAt','operator','line'})
        if quote['book'] not in {'fanduel','draftkings'} or quote['book'] in seen:raise ValueError('Duplicate or unsupported book price')
        seen.add(quote['book']);stamp(quote['capturedAt'])
        if quote['capturedAt'] is None or not number(quote['americanOdds']) or abs(quote['americanOdds'])<100:raise ValueError('Invalid saved book price')
        if quote['operator'] not in {'>','<','>=','<=','gt','lt','gte','lte'} or not number(quote['line']) or quote['line']<0 or price_outcome(quote)!=price_outcome(row):raise ValueError('Book price changes pick outcome or push')


def validate_honorable_mentions(rows):
    def family(row):
        return (row.get('date'),row.get('canonicalEventId') or row.get('eventId'),row.get('playerId'),row.get('market'),row.get('period','full_game'),row.get('product','sportsbook'))
    selected={family(r) for r in rows if r.get('group')=='research' and r.get('category') in {'value_safe','high_probability_aggressive'}}
    seen=set()
    for row in rows:
        if row.get('category')!='honorable_mention':continue
        if row.get('selected') is not False:raise ValueError('Honorable mention must remain non-selected')
        key=family(row)
        if key in selected or key in seen:raise ValueError('Duplicate honorable mention family')
        if not row.get('playerId') or not (row.get('canonicalEventId') or row.get('eventId')):raise ValueError('Honorable mention identity unavailable')
        seen.add(key)
        price=row.get('americanOdds');prob=row.get('estimate',{}).get('winProbability')
        if not number(price) or price < -500 or abs(price)<100 or not number(prob) or prob<.7:raise ValueError('Honorable mention price or probability outside published bounds')

def validate_personal_slips(body):
    if 'personalSlips' not in body and 'personalPublication' not in body:return
    publication=body.get('personalPublication');keys(publication,{'recordedAt','publishedAt'},{'recordedAt','publishedAt'})
    for key in ['recordedAt','publishedAt']:stamp(publication[key])
    if publication['recordedAt'] is None:raise ValueError('Missing personal recording time')
    parsed=lambda value:datetime.fromisoformat(value.replace('Z','+00:00'))
    if publication['publishedAt'] is not None and parsed(publication['publishedAt'])<parsed(publication['recordedAt']):raise ValueError('Personal publication precedes recording')
    if body.get('sharedBetslipUrl') or body.get('sharedBetslipOdds') is not None or body.get('favoritesPostedAt') is not None:raise ValueError('Separate slips cannot also claim one legacy slip')
    slips=body.get('personalSlips')
    if not isinstance(slips,list) or not 1<=len(slips)<=12:raise ValueError('Invalid separate personal slips')
    rows={r['id']:r for r in body['props'] if r['group']=='ry'};seen=set();referenced=set()
    for slip in slips:
        fields={'id','book','americanOdds','placedAt','ryFavorite','legs'};keys(slip,fields,fields)
        if not isinstance(slip['id'],str) or not re.fullmatch(r'ry-\d{4}-\d{2}-\d{2}-\d{2}',slip['id']) or not slip['id'].startswith('ry-'+body['date']+'-') or slip['id'] in seen:raise ValueError('Invalid or duplicate personal slip identity')
        seen.add(slip['id'])
        if slip['book'] not in {'fanduel','draftkings'} or type(slip['ryFavorite']) is not bool:raise ValueError('Invalid personal slip attribution')
        if not number(slip['americanOdds']) or abs(slip['americanOdds'])<100:raise ValueError('Invalid personal full-ticket quote')
        stamp(slip['placedAt'])
        if slip['placedAt'] is not None and parsed(slip['placedAt'])>parsed(publication['recordedAt']):raise ValueError('Personal placement follows recording')
        if not isinstance(slip['legs'],list) or not 2<=len(slip['legs'])<=12:raise ValueError('Invalid personal slip legs')
        legs=set()
        for leg in slip['legs']:
            keys(leg,{'pickId','americanOdds'},{'pickId','americanOdds'})
            if leg['pickId'] not in rows or leg['pickId'] in legs:raise ValueError('Missing or duplicate personal slip pick')
            legs.add(leg['pickId']);referenced.add(leg['pickId'])
            if not number(leg['americanOdds']) or abs(leg['americanOdds'])<100:raise ValueError('Invalid personal leg quote')
    if referenced!=set(rows):raise ValueError('Unattributed personal pick')
    if any(r.get('postedAt')!=publication['publishedAt'] for r in rows.values()):raise ValueError('Personal pick publication time mismatch')

def validate_edition(body):
    keys(body,EDITION_FIELDS,{'schemaVersion','channel','date','props'})
    if body['schemaVersion']!='public-1' or body['channel'] not in {'daily','sunday'}: raise ValueError('Invalid edition')
    day(body['date'])
    for key in ('firstPublishedAt','recordedAt','updatedAt','favoritesPostedAt'): stamp(body.get(key))
    if body.get('timezone')!='America/New_York': raise ValueError('Invalid timezone')
    text(body.get('priceNote',''))
    if body.get('sharedBetslipUrl') is not None and not re.fullmatch(r'https://sportsbook\.fanduel\.com/addToBetslip\?shareCode=[a-zA-Z0-9]{1,64}',body['sharedBetslipUrl']): raise ValueError('Invalid shared slip URL')
    if body.get('sharedBetslipOdds') is not None and (not number(body['sharedBetslipOdds']) or abs(body['sharedBetslipOdds'])<100): raise ValueError('Invalid shared slip price')
    if not isinstance(body['props'],list): raise ValueError('Invalid picks')
    seen=set()
    for row in body['props']:
        keys(row,PICK_FIELDS,{'id','date','player','market','operator','line','group'})
        if row['id'] in seen: raise ValueError('Duplicate pick')
        seen.add(row['id']);day(row['date'])
        if row['date']!=body['date'] or row['group'] not in {'ry','research'}: raise ValueError('Pick edition mismatch')
        if 'category' in row and (row['group']!='research' or row['category'] not in {'value_safe','high_probability_aggressive','not_a_pick','honorable_mention'}): raise ValueError('Invalid published category')
        if row['market'] not in MARKETS or row['operator'] not in {'>','<','>=','<=','gt','lt','gte','lte'} or not number(row['line']) or row['line']<0: raise ValueError('Invalid exact contract')
        if row.get('americanOdds') is not None and (not number(row['americanOdds']) or abs(row['americanOdds'])<100): raise ValueError('Invalid price')
        if row.get('overtime') not in {None,True,False}: raise ValueError('Invalid overtime terms')
        if 'ryFavorite' in row and type(row['ryFavorite']) is not bool: raise ValueError('Invalid Ry favorite flag')
        if 'selected' in row and type(row['selected']) is not bool: raise ValueError('Invalid selected status')
        for key in ('capturedAt','startTime','postedAt'): stamp(row.get(key))
        for key,value in row.items():
            if key not in {'line','americanOdds','overtime','result','resultSource','estimate','priceCheck','ryFavorite','selected','confidenceUpdate','bookPrices'} and value is not None: text(value)
        if 'confidenceUpdate' in row:validate_confidence_update(row['confidenceUpdate'],row)
        if 'bookPrices' in row:validate_book_prices(row['bookPrices'],row)
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
            validate_estimate(row['estimate'])
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
            if result['statisticalOutcome'] not in {'win','loss','push','out','dnp','canceled','postponed','pending','unavailable','reached','not_reached'}: raise ValueError('Invalid outcome')
            if result['statisticalOutcome'] in {'win','loss','push'} and (result['eventStatus']!='final' or result.get('actual') is None): raise ValueError('Final outcome requires final stats')
            if result.get('sportsbookSettlement') not in {None,'unverified'}: raise ValueError('Statistical results cannot verify settlement')
            stamp(result.get('checkedAt'))
            if result.get('source') and not re.fullmatch(r'https://(?:www\.espn\.com/nba/boxscore/_/gameId/\d+|stats\.nba\.com/stats/boxscoresummaryv3\?GameID=\d{10}|site\.api\.espn\.com/apis/site/v2/sports/basketball/nba/injuries)',result['source']): raise ValueError('Unsupported result URL')
            if (result.get('source') or '').startswith('https://stats.nba.com/') and result['source']!='https://stats.nba.com/stats/boxscoresummaryv3?GameID='+(row.get('canonicalEventId') or row['eventId']).removeprefix('nba:'): raise ValueError('Inactive result requires exact official NBA game')
    validate_honorable_mentions(body['props'])
    validate_personal_slips(body)
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
