"""Consumer profile facts only. No private feature vectors or selection rules."""
import re
from public_schema import keys,day,stamp,text,number,MARKETS

NBA_TEAMS=set('ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split())

def identity(v):
    if not isinstance(v,str) or not re.fullmatch(r'nba:\d{1,12}',v):raise ValueError('Invalid profile player')
def version(v):
    if not isinstance(v,str) or not re.fullmatch(r'[a-f0-9]{16}',v):raise ValueError('Invalid profile version')
def validate_profile_index(body):
    keys(body,{'schemaVersion','asOfDate','players'},{'schemaVersion','asOfDate','players'})
    if body['schemaVersion']!='public-player-profiles-1' or not isinstance(body['players'],list) or len(body['players'])>2000:raise ValueError('Invalid profiles')
    day(body['asOfDate']);seen=set()
    for p in body['players']:
        keys(p,{'id','name','path','version','team'},{'id','name','path','version'});identity(p['id']);version(p['version']);text(p['name'],120)
        if 'team' in p and p['team'] not in NBA_TEAMS:raise ValueError('Invalid directory team')
        if p['id'] in seen or p['path']!=p['id'].split(':')[1]+'/'+p['version']+'.json':raise ValueError('Invalid profile path')
        seen.add(p['id'])
def positive(v,limit=1000):
    if not number(v) or not 0<=v<=limit:raise ValueError('Invalid public profile statistic')
def validate_profile(body):
    keys(body,{'schemaVersion','playerId','player','asOfDate','bio','basicPosition','upcoming','version'},{'schemaVersion','playerId','player','asOfDate','version'})
    if body['schemaVersion']!='public-player-profile-1':raise ValueError('Invalid profile')
    identity(body['playerId']);version(body['version']);text(body['player'],120);day(body['asOfDate'])
    if 'basicPosition' in body:text(body['basicPosition'],30)
    if 'bio' in body:
        b=body['bio'];fields={'source','capturedAt','espnId','height','weight','birthDate','age','jersey','draft','experience','college','position','team','teamAbbreviation','status','headshot','teamLogo'};keys(b,fields,{'source','capturedAt','espnId'})
        if not re.fullmatch(r'\d{1,12}',b['espnId']) or b['source']!='https://www.espn.com/nba/player/bio/_/id/'+b['espnId']:raise ValueError('Invalid ESPN bio source')
        stamp(b['capturedAt'])
        for k,v in b.items():
            if k=='age':positive(v,120)
            elif k in {'headshot','teamLogo'}:
                if not re.fullmatch(r'https://a\.espncdn\.com/i/(?:headshots/nba/players/full/\d+|teamlogos/nba/500/[a-z]+)\.png',v):raise ValueError('Invalid ESPN image')
            else:text(v,250)
    if 'upcoming' not in body:return
    u=body['upcoming'];fields={'espnEventId','date','startTime','team','teamAbbreviation','opponent','opponentAbbreviation','home','asOf','editionPath','editionVersion','pickIds','researchIds','markets','opponentHistory'};keys(u,fields,fields-{'opponentHistory'});day(u['date']);stamp(u['asOf']);stamp(u['startTime']);version(u['editionVersion'])
    if u['date']!=body['asOfDate'] or u['editionPath']!=f"daily/{u['date']}/{u['editionVersion']}.json" or not re.fullmatch(r'\d{1,12}',u['espnEventId']) or type(u['home']) is not bool:raise ValueError('Invalid upcoming event')
    for k in ('team','teamAbbreviation','opponent','opponentAbbreviation'):text(u[k],100)
    if u['teamAbbreviation'] not in NBA_TEAMS or u['opponentAbbreviation'] not in NBA_TEAMS or u['teamAbbreviation']==u['opponentAbbreviation']:raise ValueError('Invalid canonical NBA team abbreviation')
    for k in ('pickIds','researchIds'):
        if not isinstance(u[k],list) or len(u[k])>100 or len(set(u[k]))!=len(u[k]) or any(not isinstance(v,str) or not re.fullmatch(r'[a-f0-9]{64}',v) for v in u[k]):raise ValueError('Invalid published prop reference')
    if not isinstance(u['markets'],list) or len(u['markets'])>10:raise ValueError('Invalid profile markets')
    if 'opponentHistory' in u:
        h=u['opponentHistory'];allowed={'path','version','games','fromSeason','through','missingSeasons','averages'};keys(h,allowed,allowed);version(h['version']);day(h['through'])
        from public_schema import season_name
        season_name(h['fromSeason']);positive(h['games'],500)
        if h['path']!=body['playerId'].split(':')[1]+'/'+u['opponentAbbreviation']+'/'+h['version']+'.json' or h['through']>=u['date']:raise ValueError('Invalid career opponent history reference')
        if not isinstance(h['missingSeasons'],list) or len(h['missingSeasons'])>70:raise ValueError('Invalid career history gaps')
        for s in h['missingSeasons']:season_name(s)
        keys(h['averages'],MARKETS|{'BLK','STL','MIN'},MARKETS|{'BLK','STL','MIN'})
        for v in h['averages'].values():
            if v is not None:positive(v)
    seen=set()
    for m in u['markets']:
        keys(m,{'market','referenceId','projection','expectedMinutes','recent','opponentDefense','contextApplied','defender','teammateImpact'},{'market','referenceId','projection','expectedMinutes','recent'})
        if m['market'] not in MARKETS or m['market'] in seen or not re.fullmatch(r'[a-f0-9]{64}',m['referenceId']):raise ValueError('Invalid profile market')
        seen.add(m['market']);positive(m['projection']);positive(m['expectedMinutes'],60)
        if not isinstance(m['recent'],list) or len(m['recent'])>5:raise ValueError('Invalid form samples')
        for s in m['recent']:
            keys(s,{'label','games','average'},{'label','games','average'});positive(s['average']);positive(s['games'],1000)
            if s['label'] not in {'Last 5','Last 10','Last 20','This season','Last season'} or type(s['games']) is not int:raise ValueError('Invalid recent form')
        if 'opponentDefense' in m:
            d=m['opponentDefense'];keys(d,{'defensiveRating','games','seasonGames','through'},{'defensiveRating','games','seasonGames','through'});positive(d['defensiveRating'],250);positive(d['games']);positive(d['seasonGames']);day(d['through'])
            if type(m.get('contextApplied')) is not bool or d['through']>=u['date']:raise ValueError('Invalid defensive context cutoff')
        if 'defender' in m:
            d=m['defender'];keys(d,{'playerId','player','through','source','history','coverage'},{'playerId','player','through','source','history'});identity(d['playerId']);text(d['player'],120);day(d['through'])
            if d['source']!='https://www.nba.com/stats/player/'+body['playerId'].split(':')[1]+'/head-to-head' or not isinstance(d['history'],list) or len(d['history'])>70:raise ValueError('Invalid matchup evidence')
            for h in d['history']:
                keys(h,{'season','through','games','possessions','minutes','stats'},{'season','through','games','possessions','minutes','stats'});day(h['through']);positive(h['games']);positive(h['possessions'],10000);text(h['minutes'],30);keys(h['stats'],{'PTS','AST','3PM'},{'PTS','AST','3PM'})
                if not re.fullmatch(r'\d{4}-\d{2}',h['season']) or h['through']>=u['date']:raise ValueError('Invalid defender history cutoff')
                for v in h['stats'].values():
                    if v is not None:positive(v,10000)
            if 'coverage' in d:
                from public_schema import season_name
                c=d['coverage'];keys(c,{'requestedFromSeason','seasonsCovered','missingSeasons'},{'requestedFromSeason','seasonsCovered','missingSeasons'});season_name(c['requestedFromSeason'])
                for k in ('seasonsCovered','missingSeasons'):
                    if not isinstance(c[k],list) or len(c[k])>70 or c[k]!=sorted(set(c[k])):raise ValueError('Invalid defender career coverage')
                    for season in c[k]:season_name(season)
                if set(c['seasonsCovered'])&set(c['missingSeasons']):raise ValueError('Conflicting defender coverage')
                if any(h['season'] not in c['seasonsCovered'] for h in d['history']):raise ValueError('Defender history outside available coverage')
        if 'teammateImpact' in m:
            t=m['teammateImpact'];keys(t,{'teammates','applied','direction','asOf','source'},{'teammates','applied','direction','asOf','source'});stamp(t['asOf'])
            if type(t['applied']) is not bool or t['direction'] not in {'up','down','unchanged','uncertain'} or not t['applied'] and t['direction']!='uncertain' or t['source']!='https://www.espn.com/nba/injuries' or not isinstance(t['teammates'],list) or len(t['teammates'])>20:raise ValueError('Invalid injury impact')
            for x in t['teammates']:
                keys(x,{'playerId','player','status'},{'playerId','player','status'});identity(x['playerId']);text(x['player'],120);text(x['status'],50)
