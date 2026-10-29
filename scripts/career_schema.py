"""Strict public contract for basic career opponent game logs."""
import re
from public_schema import keys,day,stamp,text,season_name,number,validate_game_log
from profile_schema import identity,version,NBA_TEAMS

def validate_career_history(b):
    fields={'schemaVersion','playerId','player','opponent','opponentTeamId','requestedFromSeason','through','seasonsCovered','missingSeasons','capturedAt','source','games','version'};keys(b,fields,fields)
    if b['schemaVersion']!='public-career-opponent-1' or b['source']!='https://stats.nba.com/stats/leaguegamelog':raise ValueError('Invalid career history')
    identity(b['playerId']);text(b['player'],120);version(b['version']);season_name(b['requestedFromSeason']);day(b['through']);stamp(b['capturedAt'])
    if b['opponent'] not in NBA_TEAMS or not re.fullmatch(r'161061\d{4}',b['opponentTeamId']):raise ValueError('Invalid career opponent')
    for key in ('seasonsCovered','missingSeasons'):
        if not isinstance(b[key],list) or len(b[key])>70 or b[key]!=sorted(set(b[key])):raise ValueError('Invalid career coverage')
        for s in b[key]:season_name(s)
    if set(b['seasonsCovered'])&set(b['missingSeasons']):raise ValueError('Conflicting career coverage')
    latest=int(b['through'][:4])-(int(b['through'][5:7])<7);expected={f'{y}-{str(y+1)[-2:]}' for y in range(int(b['requestedFromSeason'][:4]),latest+1)}
    if set(b['seasonsCovered'])|set(b['missingSeasons'])!=expected:raise ValueError('Unreported career coverage gap')
    if not isinstance(b['games'],list) or len(b['games'])>500:raise ValueError('Invalid career game count')
    seasons={};seen=set()
    for g in b['games']:
        keys(g,{'season','eventId','date','team','opponent','home','stats'},{'season','eventId','date','team','opponent','home','stats'});season_name(g['season'])
        if g['season'] not in b['seasonsCovered'] or g['date']>b['through'] or g['eventId'] in seen:raise ValueError('Career game outside coverage')
        canonical={'NJN':'BKN','SEA':'OKC','NOH':'NOP','NOK':'NOP','CHH':'NOP'}.get(g['opponent'],g['opponent'])
        if canonical!=b['opponent']:raise ValueError('Wrong opponent franchise in career log')
        seen.add(g['eventId']);seasons.setdefault(g['season'],[]).append({k:v for k,v in g.items() if k!='season'})
    for season,games in seasons.items():validate_game_log({'schemaVersion':'public-game-log-1','season':season,'playerId':b['playerId'],'player':b['player'],'version':b['version'],'games':games})

def validate_career_index(b):
    fields={'schemaVersion','asOfDate','matchups'};keys(b,fields,fields)
    if b['schemaVersion']!='public-career-opponents-1' or not isinstance(b['matchups'],list) or len(b['matchups'])>2000:raise ValueError('Invalid career history directory')
    day(b['asOfDate']);seen=set()
    for p in b['matchups']:
        keys(p,{'playerId','opponent','path','version'},{'playerId','opponent','path','version'});identity(p['playerId']);version(p['version'])
        if p['opponent'] not in NBA_TEAMS or p['path']!=p['playerId'].split(':')[1]+'/'+p['opponent']+'/'+p['version']+'.json' or (p['playerId'],p['opponent']) in seen:raise ValueError('Invalid career history path')
        seen.add((p['playerId'],p['opponent']))

def validate_defender_index(b):
    fields={'schemaVersion','asOfDate','matchups'};keys(b,fields,fields)
    if b['schemaVersion']!='public-career-defender-games-index-1' or not isinstance(b['matchups'],list) or len(b['matchups'])>4000:raise ValueError('Invalid defender-game directory')
    day(b['asOfDate']);seen=set()
    for p in b['matchups']:
        fields={'playerId','defenderId','path','version'};keys(p,fields,fields);identity(p['playerId']);identity(p['defenderId']);version(p['version'])
        pair=(p['playerId'],p['defenderId'])
        if pair[0]==pair[1] or pair in seen or p['path']!=pair[0].split(':')[1]+'/'+pair[1].split(':')[1]+'/'+p['version']+'.json':raise ValueError('Invalid defender-game path')
        seen.add(pair)

def validate_defender_games(b):
    fields={'schemaVersion','playerId','player','defenderId','defender','requestedFromSeason','through','seasonsCovered','missingSeasons','capturedAt','source','games','version'};keys(b,fields,fields)
    if b['schemaVersion']!='public-career-defender-games-1' or b['source']!='https://stats.nba.com/stats/leaguegamelog':raise ValueError('Invalid defender-game history')
    identity(b['playerId']);identity(b['defenderId']);text(b['player'],120);text(b['defender'],120);version(b['version']);season_name(b['requestedFromSeason']);day(b['through']);stamp(b['capturedAt'])
    if b['playerId']==b['defenderId']:raise ValueError('Player cannot guard themselves')
    for key in ('seasonsCovered','missingSeasons'):
        if not isinstance(b[key],list) or len(b[key])>70 or b[key]!=sorted(set(b[key])):raise ValueError('Invalid defender-game coverage')
        for s in b[key]:season_name(s)
    latest=int(b['through'][:4])-(int(b['through'][5:7])<7);expected={f'{y}-{str(y+1)[-2:]}' for y in range(int(b['requestedFromSeason'][:4]),latest+1)}
    if set(b['seasonsCovered'])&set(b['missingSeasons']) or set(b['seasonsCovered'])|set(b['missingSeasons'])!=expected:raise ValueError('Unreported defender-game coverage gap')
    if not isinstance(b['games'],list) or len(b['games'])>1000:raise ValueError('Invalid defender-game count')
    seasons={};seen=set();alias={'NJN':'BKN','SEA':'OKC','NOH':'NOP','NOK':'NOP','CHH':'NOP'}
    for g in b['games']:
        fields={'season','eventId','date','team','opponent','home','stats','defenderTeam','defenderMinutes'};keys(g,fields,fields);season_name(g['season'])
        if g['season'] not in b['seasonsCovered'] or g['date']>b['through'] or g['eventId'] in seen:raise ValueError('Defender game outside coverage')
        if alias.get(g['defenderTeam'],g['defenderTeam'])!=alias.get(g['opponent'],g['opponent']) or alias.get(g['team'],g['team'])==alias.get(g['defenderTeam'],g['defenderTeam']):raise ValueError('Defender must be on the opposing team')
        if not number(g['defenderMinutes']) or not 0<=g['defenderMinutes']<=90 or not number(g['stats'].get('MIN')) or not 0<=g['stats']['MIN']<=90:raise ValueError('Invalid appearance minutes')
        seen.add(g['eventId']);seasons.setdefault(g['season'],[]).append({k:v for k,v in g.items() if k not in {'season','defenderTeam','defenderMinutes'}})
    for season,games in seasons.items():validate_game_log({'schemaVersion':'public-game-log-1','season':season,'playerId':b['playerId'],'player':b['player'],'version':b['version'],'games':games})
