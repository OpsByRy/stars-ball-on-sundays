"""Only sourced home/away identity facts for public matchup headings."""
import re
from public_schema import keys,day,stamp,text
from profile_schema import NBA_TEAMS

def validate_matchups(body):
    fields={'schemaVersion','source','capturedAt','games'};keys(body,fields,fields)
    if body['schemaVersion']!='public-matchup-directory-1' or body['source']!='https://www.nba.com/schedule':raise ValueError('Invalid matchup directory')
    stamp(body['capturedAt'])
    if not isinstance(body['games'],list) or len(body['games'])>2000:raise ValueError('Invalid matchup directory size')
    seen=set()
    for game in body['games']:
        fields={'date','nbaEventId','eventIds','awayTeam','homeTeam'};keys(game,fields,fields);day(game['date'])
        if not re.fullmatch(r'002\d{7}',game['nbaEventId']):raise ValueError('Invalid NBA game identity')
        if not isinstance(game['eventIds'],list) or not game['eventIds'] or len(game['eventIds'])>30 or game['eventIds']!=sorted(set(game['eventIds'])):raise ValueError('Invalid game aliases')
        for event in game['eventIds']:
            text(event,150)
            if not re.fullmatch(r'(?:nba|espn|propline):\d{1,20}',event):raise ValueError('Invalid game alias')
            if (game['date'],event) in seen:raise ValueError('Ambiguous game identity')
            seen.add((game['date'],event))
        for k in ('awayTeam','homeTeam'):
            keys(game[k],{'name','abbreviation'},{'name','abbreviation'});text(game[k]['name'],100)
            if game[k]['abbreviation'] not in NBA_TEAMS:raise ValueError('Invalid matchup team')
        if game['awayTeam']['abbreviation']==game['homeTeam']['abbreviation']:raise ValueError('A team cannot play itself')
