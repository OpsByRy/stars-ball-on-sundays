import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from availability_schema import validate_availability
from public_schema import validate_edition
import build

class AvailabilityBoundary(unittest.TestCase):
    def test_exact_inactive_facts_are_public_and_reject_private_fields_or_wrong_source_games(self):
        body=json.loads((ROOT/'data/player-availability.json').read_text());validate_availability(body)
        self.assertEqual({u['playerId'] for u in body['updates'] if u['date']=='2026-10-28'},{'nba:1629029','nba:1630533'})
        self.assertEqual(build.availability_files(ROOT),['data/player-availability.json'])
        bad=copy.deepcopy(body);bad['updates'][0]['privateFeature']=[1,2]
        with self.assertRaisesRegex(ValueError,'unknown'):validate_availability(bad)
        bad=copy.deepcopy(body);bad['updates'][0]['source']='https://stats.nba.com/stats/boxscoresummaryv3?GameID=0022609999'
        with self.assertRaisesRegex(ValueError,'exact official'):validate_availability(bad)
        index=json.loads((ROOT/'data/editions/manifest.json').read_text())
        entry=next(e for e in reversed(index['editions']) if e['channel']=='daily' and e['date']=='2026-10-28')
        edition=json.loads((ROOT/'data/editions'/entry['path']).read_text())
        row=next(r for r in edition['props'] if r['playerId']=='nba:1629029');edition['props']=[row];validate_edition(edition)
        row['result']['source']='https://stats.nba.com/stats/boxscoresummaryv3?GameID=0022609999'
        with self.assertRaisesRegex(ValueError,'exact official'):validate_edition(edition)
