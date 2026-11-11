import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import build
import profile_schema

def view(root=ROOT):
    return build.identity_view(root)['data/player-identity.json']

class PlayerIdentityDirectory(unittest.TestCase):
    def test_real_data_builds_a_valid_directory(self):
        v=view();profile_schema.validate_player_identity(v)
        self.assertEqual(v['schemaVersion'],'public-player-identity-1')
        self.assertGreater(len(v['players']),500)
        ids=[p['id'] for p in v['players']];self.assertEqual(ids,sorted(ids));self.assertEqual(len(ids),len(set(ids)))

    def test_only_icon_facts_are_published(self):
        for p in view()['players']:self.assertLessEqual(set(p),{'id','team','jersey','pos'})

    def test_every_published_value_is_canonical(self):
        for p in view()['players']:
            if 'team' in p:self.assertIn(p['team'],profile_schema.NBA_TEAMS)
            if 'jersey' in p:self.assertRegex(p['jersey'],r'^\d{1,2}$')
            if 'pos' in p:self.assertIn(p['pos'],profile_schema.IDENTITY_POSITIONS)

    def test_positions_are_espn_families_only_never_five_position_guesses(self):
        for p in view()['players']:self.assertNotIn(p.get('pos'),{'PG','SG','SF','PF'})

    def test_directory_agrees_with_the_validated_bios(self):
        index=json.loads((ROOT/'data/player-profiles/index.json').read_text());v={p['id']:p for p in view()['players']}
        checked=0
        for entry in index['players']:
            bio=json.loads((ROOT/'data/player-profiles'/entry['path']).read_text()).get('bio',{})
            if bio.get('jersey') and entry['id'] in v:
                self.assertEqual(v[entry['id']]['jersey'],str(bio['jersey']).lstrip('#'));checked+=1
        self.assertGreater(checked,300)

    def test_validator_rejects_bad_records(self):
        good=view()
        for mutate in (lambda b:b['players'][0].update(team='XXX'),lambda b:b['players'][0].update(jersey='123'),lambda b:b['players'][0].update(jersey='7a'),
                       lambda b:b['players'][0].update(pos='PG'),lambda b:b['players'][0].update(archetype='scorer'),lambda b:b['players'][0].update(id='espn:1'),
                       lambda b:b['players'].append(copy.deepcopy(b['players'][0])),lambda b:b.update(schemaVersion='public-player-identity-2'),lambda b:b.update(extra=1)):
            bad=copy.deepcopy(good);mutate(bad)
            with self.assertRaises(ValueError):profile_schema.validate_player_identity(bad)

    def test_aliases_hybrids_and_missing_facts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'data/player-profiles/1').mkdir(parents=True)
            entries=[];bodies={
                '1':{'bio':{'teamAbbreviation':'NY','jersey':'#5','position':'Guard'}},   # alias + hash-prefixed number
                '2':{'basicPosition':'F-G'},                                               # hybrid normalised to G-F, no bio
                '3':{'bio':{'teamAbbreviation':'ZZZ','jersey':'ABC','position':'Wing'}},    # nothing usable -> omitted
                '4':{'bio':{'position':'Center'}}}
            for k,b in bodies.items():
                (root/'data/player-profiles'/k).mkdir(exist_ok=True);path=k+'/f'+k+'.json'
                (root/'data/player-profiles'/path).write_text(json.dumps({'playerId':'nba:'+k,'player':'P'+k,**b}));entries.append({'id':'nba:'+k,'name':'P'+k,'path':path,'version':'f'*16,**({'team':'BOS'} if k=='4' else {})})
            (root/'data/player-profiles/index.json').write_text(json.dumps({'schemaVersion':'public-player-profiles-1','asOfDate':'2026-11-01','players':entries}))
            got={p['id']:p for p in view(root)['players']}
        self.assertEqual(got['nba:1'],{'id':'nba:1','team':'NYK','jersey':'5','pos':'G'})
        self.assertEqual(got['nba:2'],{'id':'nba:2','pos':'G-F'})
        self.assertNotIn('nba:3',got)
        self.assertEqual(got['nba:4'],{'id':'nba:4','team':'BOS','pos':'C'})

    def test_build_writes_the_file_into_dist_views(self):
        self.assertIn('data/player-identity.json',build.identity_view(ROOT))

if __name__=='__main__':unittest.main()
