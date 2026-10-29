import copy
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build import defender_files
from career_schema import validate_defender_games,validate_defender_index


class DefenderGameBoundary(unittest.TestCase):
    def body(self):
        index=json.loads((ROOT/'data/defender-games/index.json').read_text())
        entry=next(e for e in index['matchups'] if e['playerId']=='nba:201935' and e['defenderId']=='nba:1630700')
        return json.loads((ROOT/'data/defender-games'/entry['path']).read_text())

    def test_all_saved_defender_pairs_have_safe_paths_and_valid_digests(self):
        self.assertGreater(len(defender_files(ROOT)),20)
        body=self.body();self.assertEqual({g['defenderTeam'] for g in body['games']},{'ATL','NOP'})
        self.assertTrue(all(g['date']<'2026-10-29' for g in body['games']))
        for target in [body,body['games'][0],body['games'][0]['stats']]:
            target['private_vector']=[1,2]
            with self.assertRaisesRegex(ValueError,'unknown'):validate_defender_games(body)
            target.pop('private_vector')

    def test_wrong_defender_team_duplicates_and_missing_coverage_fail_closed(self):
        body=self.body()
        changed=copy.deepcopy(body);changed['games'][0]['defenderTeam']='GSW'
        with self.assertRaisesRegex(ValueError,'opposing'):validate_defender_games(changed)
        changed=copy.deepcopy(body);changed['games'].append(changed['games'][0])
        with self.assertRaisesRegex(ValueError,'coverage'):validate_defender_games(changed)
        changed=copy.deepcopy(body);changed['seasonsCovered'].pop()
        with self.assertRaisesRegex(ValueError,'coverage gap'):validate_defender_games(changed)
        index=json.loads((ROOT/'data/defender-games/index.json').read_text());index['matchups'][0]['path']='../../engine.sqlite3'
        with self.assertRaisesRegex(ValueError,'path'):validate_defender_index(index)
