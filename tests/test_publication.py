import copy
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import build
import public_schema as schema
import profile_schema
import career_schema

class PublicationBoundary(unittest.TestCase):
    def edition(self):
        index=json.loads((ROOT/'data/editions/manifest.json').read_text())
        return json.loads((ROOT/'data/editions'/index['editions'][0]['path']).read_text())

    def test_real_publications_and_digests_validate(self):
        self.assertGreater(len(build.publication_files(ROOT)),3)

    def test_game_logs_have_verified_hashes_and_only_public_box_scores(self):
        files=build.game_log_files(ROOT)
        self.assertGreater(len(files),400)
        index=json.loads((ROOT/'data/player-logs/index.json').read_text())
        body=json.loads((ROOT/'data/player-logs'/index['players'][0]['path']).read_text())
        schema.validate_game_log_index(index);schema.validate_game_log(body)
        for target in (body,body['games'][0],body['games'][0]['stats']):
            target['private_feature']='never publish'
            with self.assertRaisesRegex(ValueError,'unknown'):schema.validate_game_log(body)
            target.pop('private_feature')
        altered=copy.deepcopy(index);altered['players'][0]['path']='../../engine.sqlite3'
        with self.assertRaisesRegex(ValueError,'path'):schema.validate_game_log_index(altered)

    def test_profile_facts_and_forecasts_match_immutable_public_selections(self):
        files=build.profile_files(ROOT);self.assertGreater(len(files),600)
        index=json.loads((ROOT/'data/player-profiles/index.json').read_text())
        profiles=[json.loads((ROOT/'data/player-profiles'/p['path']).read_text()) for p in index['players']]
        body=next(p for p in profiles if p.get('bio') and p.get('upcoming',{}).get('markets') and p['upcoming']['markets'][0]['recent'])
        self.assertTrue(body['bio']['source'].startswith('https://www.espn.com/'))
        for target in (body,body['bio'],body['upcoming'],body['upcoming']['markets'][0],body['upcoming']['markets'][0]['recent'][0]):
            target['private_feature_vector']=[1,2,3]
            with self.assertRaisesRegex(ValueError,'unknown'):profile_schema.validate_profile(body)
            target.pop('private_feature_vector')
        bad=copy.deepcopy(index);bad['players'][0]['path']='../../engine.sqlite3'
        with self.assertRaisesRegex(ValueError,'path'):profile_schema.validate_profile_index(bad)
        m=body['upcoming']['markets'][0];m['opponentDefense']['through']=body['asOfDate']
        with self.assertRaisesRegex(ValueError,'cutoff'):profile_schema.validate_profile(body)

    def test_career_opponent_history_has_full_coverage_and_rejects_private_fields(self):
        files=build.career_files(ROOT);self.assertGreater(len(files),300)
        index=json.loads((ROOT/'data/career-matchups/index.json').read_text());entry=next(p for p in index['matchups'] if p['playerId']=='nba:1627759');body=json.loads((ROOT/'data/career-matchups'/entry['path']).read_text())
        self.assertEqual(body['requestedFromSeason'],'2016-17');self.assertGreaterEqual(len(body['games']),30);self.assertEqual(min(g['date'] for g in body['games'])[:4],'2016');self.assertEqual(body['missingSeasons'],[])
        for target in (body,body['games'][0],body['games'][0]['stats']):
            target['private_vector']=[1,2,3]
            with self.assertRaisesRegex(ValueError,'unknown'):career_schema.validate_career_history(body)
            target.pop('private_vector')
        broken=copy.deepcopy(body);broken['seasonsCovered'].remove('2020-21')
        with self.assertRaisesRegex(ValueError,'coverage gap'):career_schema.validate_career_history(broken)
        broken=copy.deepcopy(body);broken['games'][0]['opponent']='GSW'
        with self.assertRaisesRegex(ValueError,'franchise'):career_schema.validate_career_history(broken)
        index['matchups'][0]['path']='../../engine.sqlite3'
        with self.assertRaisesRegex(ValueError,'path'):career_schema.validate_career_index(index)

    def test_profile_views_reuse_exact_frozen_rows_and_keep_career_logs_separate(self):
        views=build.profile_views(ROOT)
        index=json.loads((ROOT/'data/player-profiles/index.json').read_text())
        expected=sum('upcoming' in json.loads((ROOT/'data/player-profiles'/p['path']).read_text()) for p in index['players'])
        self.assertEqual(len(views),expected);self.assertGreater(len(views),0)
        view=next(v for v in views.values() if v['props'])
        editions=json.loads((ROOT/'data/editions/manifest.json').read_text())['editions']
        entry=next(e for e in editions if e['version']==view['version'] and e['date']==view['date'] and e['channel']=='daily')
        source=json.loads((ROOT/'data/editions'/entry['path']).read_text());original={p['id']:p for p in source['props']}
        for p in view['props']:self.assertEqual(p,original[p['id']])
        self.assertLess(len(build.canonical(view)),len(build.canonical(source))/100)
        self.assertEqual(set(view),{'schemaVersion','version','playerId','date','props'})

    def test_small_board_views_preserve_saved_picks_without_loading_passed_research(self):
        index=json.loads((ROOT/'data/editions/manifest.json').read_text())
        latest={}
        for entry in index['editions']: latest[(entry['channel'],entry['date'])]=entry
        views=build.board_views(ROOT)
        for entry in latest.values():
            if entry['channel']!='daily': continue
            source=ROOT/'data/editions'/entry['path'];before=source.read_bytes();body=json.loads(before)
            view=views['data/boards/'+entry['path']]
            self.assertEqual(view['sourceVersion'],body['version'])
            expected=[p for p in body['props'] if p['group']=='ry' or p.get('category')!='not_a_pick']
            self.assertEqual(view['edition']['props'],expected)
            schema.validate_edition(view['edition'])
            self.assertEqual(source.read_bytes(),before)
            if entry['date']=='2026-10-28':
                self.assertEqual(sum(p.get('category') in {'value_safe','high_probability_aggressive'} for p in expected),48)
                self.assertEqual(sum(p.get('category')=='honorable_mention' for p in expected),10)
                self.assertLess(len(build.canonical(view)),len(before)/10)

    def test_unknown_fields_fail_at_every_level(self):
        original=self.edition()
        for place in ('root','pick','result','source','estimate'):
            body=copy.deepcopy(original)
            target=body if place=='root' else body['props'][0]
            if place=='result': target=target.setdefault('result',{'eventStatus':'scheduled','statisticalOutcome':'pending'})
            if place=='source': target=target.setdefault('resultSource',{'eventId':'123','athleteId':'456'})
            if place=='estimate': target=target.setdefault('estimate',{'projection':20,'status':'provisional'})
            target['private_canary']='NEVER_PUBLISH'
            with self.subTest(place=place),self.assertRaisesRegex(ValueError,'unknown'): schema.validate_edition(body)

    def test_invalid_results_cannot_claim_final_wins(self):
        body=self.edition();body['props'][0]['result']={'eventStatus':'live','statisticalOutcome':'win','actual':20}
        with self.assertRaisesRegex(ValueError,'Final'): schema.validate_edition(body)

    def test_minutes_and_favorite_flag_are_optional_typed_public_fields(self):
        body=self.edition();row=body['props'][0]
        row['ryFavorite']=True;row['result']={'eventStatus':'final','statisticalOutcome':'win','actual':20,'minutesPlayed':32+4/60}
        schema.validate_edition(body)
        for value in (-1,True,'32',float('nan')):
            row['result']['minutesPlayed']=value
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'minutes'):schema.validate_edition(body)
        row['result']['minutesPlayed']=0;row['ryFavorite']='yes'
        with self.assertRaisesRegex(ValueError,'favorite'):schema.validate_edition(body)

    def test_favorite_posting_times_and_shared_prices_are_validated_separately(self):
        body=self.edition();row=body['props'][0]
        body['favoritesPostedAt']='2026-10-28T02:20:48+00:00'
        body['sharedBetslipUrl']='https://sportsbook.fanduel.com/addToBetslip?shareCode=yr6GfmU'
        body['sharedBetslipOdds']=527;row['postedAt']=body['favoritesPostedAt'];row['americanOdds']=None
        schema.validate_edition(body)
        self.assertIsNone(row['americanOdds'])
        body['sharedBetslipUrl']=None
        schema.validate_edition(body)
        row['postedAt']='2026-10-27T22:20:48'
        with self.assertRaisesRegex(ValueError,'timezone'): schema.validate_edition(body)
        row['postedAt']=body['favoritesPostedAt'];body['sharedBetslipOdds']=True
        with self.assertRaisesRegex(ValueError,'slip price'): schema.validate_edition(body)

    def test_later_quote_checks_do_not_replace_saved_contract_prices(self):
        body=self.edition();row=body['props'][0];saved=row.get('americanOdds')
        row['priceCheck']={'status':'returned','americanOdds':-225,'sourceAsOf':'2026-10-27T18:17:00Z','checkedAt':'2026-10-27T18:18:43Z'}
        schema.validate_edition(body);self.assertEqual(row.get('americanOdds'),saved)
        row['priceCheck']['private_canary']='NEVER_PUBLISH'
        with self.assertRaisesRegex(ValueError,'unknown'):schema.validate_edition(body)
        row['priceCheck']={'status':'not_returned','americanOdds':None,'checkedAt':'2026-10-27T18:18:43Z'}
        schema.validate_edition(body)
        row['priceCheck']['americanOdds']=-200
        with self.assertRaisesRegex(ValueError,'empty'):schema.validate_edition(body)

    def test_published_estimates_allow_final_outputs_and_reject_invalid_probabilities(self):
        body=self.edition();row=body['props'][0]
        row['estimate']={'projection':23.5,'winProbability':0.7,'pushProbability':0.1,'lossProbability':0.2,'asOf':'2026-10-25T18:00:00Z','status':'provisional'}
        schema.validate_edition(body)
        row['estimate']['winProbability']=1.2
        with self.assertRaisesRegex(ValueError,'probabilities'):schema.validate_edition(body)
        row['estimate']={'projection':-1,'status':'provisional'}
        with self.assertRaisesRegex(ValueError,'projection'):schema.validate_edition(body)

    def test_arbitrary_files_and_raw_csv_are_never_copied(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'site';shutil.copytree(ROOT,root,ignore=shutil.ignore_patterns('dist','__pycache__'))
            for name in ('assets/private-canary.js','data/slates/private.json','data/raw.csv','pipeline/model.py','.env','docs/internal.md'):
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('NEVER_PUBLISH')
            build.build(root)
            for name in ('assets/private-canary.js','data/slates/private.json','data/raw.csv','pipeline/model.py','.env','docs/internal.md'):
                self.assertFalse((root/'dist'/name).exists(),name)
            self.assertFalse(any(p.suffix=='.csv' for p in (root/'dist').rglob('*')))

    def test_modified_records_and_unpublished_identities_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'site';shutil.copytree(ROOT,root,ignore=shutil.ignore_patterns('dist','__pycache__'))
            target=root/'data/stat-targets.json';body=json.loads(target.read_text());body['targets'].append({'date':'2026-10-25','eventId':'private-candidate','playerId':'private-candidate','espnEventId':'123','espnAthleteId':'456'});target.write_text(json.dumps(body))
            with self.assertRaisesRegex(ValueError,'Unpublished'): build.build(root)
            shutil.copyfile(ROOT/'data/stat-targets.json',target)
            index=json.loads((root/'data/editions/manifest.json').read_text());path=root/'data/editions'/index['editions'][0]['path'];body=json.loads(path.read_text());body['props'][0]['line']+=1;path.write_text(json.dumps(body))
            with self.assertRaisesRegex(ValueError,'digest'): build.build(root)

if __name__=='__main__': unittest.main()
