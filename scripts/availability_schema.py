"""Exact published player/event availability facts; never model features."""
import re
from public_schema import keys,day,stamp,text
def validate_availability(body):
    fields={'schemaVersion','updates'};keys(body,fields,fields)
    if body['schemaVersion']!='public-player-availability-1' or not isinstance(body['updates'],list) or len(body['updates'])>20000:raise ValueError('Invalid availability facts')
    seen=set()
    for u in body['updates']:
        fields={'date','eventId','playerId','status','asOf','source'};keys(u,fields,fields);day(u['date']);stamp(u['asOf'])
        if not re.fullmatch(r'(?:nba|espn|propline):\d{1,20}',u['eventId']) or not re.fullmatch(r'(?:nba|espn):\d{1,12}',u['playerId']) or u['status'] not in {'out','dnp','uncertain'}:raise ValueError('Invalid availability identity/status')
        if u['source']!='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries' and not re.fullmatch(r'https://stats\.nba\.com/stats/boxscoresummaryv3\?GameID=\d{10}',u['source']):raise ValueError('Invalid availability source')
        if u['status']=='dnp' and u['source']!='https://stats.nba.com/stats/boxscoresummaryv3?GameID='+u['eventId'].removeprefix('nba:'):raise ValueError('DNP requires exact official NBA game')
        marker=(u['date'],u['eventId'],u['playerId'],u['asOf'])
        if marker in seen:raise ValueError('Duplicate availability observation')
        seen.add(marker)
