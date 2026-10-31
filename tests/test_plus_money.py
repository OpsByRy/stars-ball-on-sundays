import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import plus_money_schema as schema

class PlusMoneyBoundary(unittest.TestCase):
    def record(self):
        index=json.loads((ROOT/'data/plus-money/manifest.json').read_text())
        return json.loads((ROOT/'data/plus-money'/index['editions'][0]['path']).read_text())

    def test_real_public_record_and_every_nested_boundary(self):
        body=self.record();schema.validate(body)
        for target in [body,body['tickets'][0],body['tickets'][0]['legs'][0],body['tickets'][0]['legs'][0]['estimate']]:
            target['private_coefficients']=[1,2,3]
            with self.assertRaisesRegex(ValueError,'unknown'):schema.validate(body)
            target.pop('private_coefficients')
        body['patterns']={'sample':'private'}
        with self.assertRaisesRegex(ValueError,'unknown'):schema.validate(body)

    def test_same_game_mixed_book_and_mispriced_reference_fail_closed(self):
        original=self.record()
        body=copy.deepcopy(original);legs=body['tickets'][0]['legs'];legs[1]['canonicalEventId']=legs[0]['canonicalEventId']
        with self.assertRaisesRegex(ValueError,'distinct games'):schema.validate(body)
        body=copy.deepcopy(original);body['tickets'][0]['legs'][0]['book']='fanduel'
        with self.assertRaisesRegex(ValueError,'Mixed sportsbook'):schema.validate(body)
        body=copy.deepcopy(original);body['tickets'][0]['indicativeAmericanOdds']+=50
        with self.assertRaisesRegex(ValueError,'price mismatch'):schema.validate(body)
        body=copy.deepcopy(original);body['tickets'][0]['priceKind']='verified'
        with self.assertRaisesRegex(ValueError,'price or status'):schema.validate(body)

    def test_manifest_path_cannot_escape_public_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);p=root/'data/plus-money/manifest.json';p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'schemaVersion':'public-plus-money-manifest-1','editions':[{'date':'2026-10-28','version':'a'*16,'path':'../../engine.sqlite3','updatedAt':'2026-10-28T17:00:00Z','count':1}]}))
            with self.assertRaisesRegex(ValueError,'path'):schema.publication_files(root,lambda r,n:r/n)

    def test_v2_accepts_reviewed_mixed_sources_and_longshots_without_rewriting_v1(self):
        index=json.loads((ROOT/'data/plus-money/manifest.json').read_text())
        records=[json.loads((ROOT/'data/plus-money'/e['path']).read_text()) for e in index['editions']]
        body=next(b for b in records if b['schemaVersion']=='public-plus-money-2' and any(t.get('section')=='longshots' for t in b['tickets']) and any(t['book']=='mixed' for t in b['tickets']))
        self.assertEqual(body['schemaVersion'],'public-plus-money-2');schema.validate(body)
        self.assertTrue(any(t['section']=='longshots' for t in body['tickets']))
        self.assertTrue(any(t['book']=='mixed' for t in body['tickets']))
        q=body['tickets'][0]['legs'][0]['bookPrices']['quotes'][0];q['private_coefficients']=[1]
        with self.assertRaisesRegex(ValueError,'unknown'):schema.validate(body)

    def test_explicit_editorial_favorite_is_optional_and_boolean(self):
        body=self.record()
        def rehash():
            body['version']=schema.hashlib.sha256(schema.canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16]
        for flag in [True,False]:
            body['tickets'][0]['ryFavorite']=flag;rehash();schema.validate(body)
        for flag in ['true',1,None]:
            body['tickets'][0]['ryFavorite']=flag;rehash()
            with self.assertRaisesRegex(ValueError,'favorite flag'):schema.validate(body)

    def test_joint_method_review_is_optional_for_history_but_atomic_and_strict(self):
        index=json.loads((ROOT/'data/plus-money/manifest.json').read_text())
        original=next(json.loads((ROOT/'data/plus-money'/e['path']).read_text()) for e in index['editions'] if json.loads((ROOT/'data/plus-money'/e['path']).read_text()).get('modelTargets'))
        body=copy.deepcopy(original);estimate=body['modelTargets'][0]['jointEstimate']
        def check():
            body['version']=schema.hashlib.sha256(schema.canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16];schema.validate(body)
        check();estimate['method']='Joint scenario model'
        with self.assertRaisesRegex(ValueError,'supplied together'):check()
        estimate.update(reviewedAt=estimate['asOf'],reviewStatus='reviewed_provisional');check()
        estimate['reviewStatus']='validated'
        with self.assertRaisesRegex(ValueError,'review evidence'):check()

    def test_new_ticket_selection_and_verified_posting_order(self):
        body=self.record();body['updatedAt']='2026-10-28T18:00:00Z'
        t=body['tickets'][0];t['selectedAt']='2026-10-28T17:20:00Z';t['postedAt']=None
        def check():
            body['version']=schema.hashlib.sha256(schema.canonical({k:v for k,v in body.items() if k!='version'})).hexdigest()[:16];schema.validate(body)
        check();t['postedAt']='2026-10-28T17:25:00Z';check()
        t['postedAt']='2026-10-28T17:19:00Z'
        with self.assertRaisesRegex(ValueError,'posting order'):check()
        t['postedAt']=None;t['selectedAt']='2026-10-29T04:00:00Z'
        with self.assertRaisesRegex(ValueError,'selection cannot follow'):check()

    def test_verified_posting_clock_can_be_added_once_and_survives_future_updates(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);directory=root/'data/plus-money';directory.mkdir(parents=True)
            original=self.record();original['firstPublishedAt']=None
            bodies=[]
            for minute,first in [(26,None),(27,'2026-10-28T17:25:54.424674Z'),(28,'2026-10-28T17:25:54.424674+00:00')]:
                body=copy.deepcopy(original);body['updatedAt']=f'2026-10-28T17:{minute}:00Z';body['firstPublishedAt']=first;body.pop('version',None)
                body['version']=schema.hashlib.sha256(schema.canonical(body)).hexdigest()[:16];schema.validate(body);bodies.append(body)
            def write(records):
                entries=[]
                for body in records:
                    target=directory/body['date']/(body['version']+'.json');target.parent.mkdir(exist_ok=True);target.write_bytes(schema.canonical(body)+b'\n')
                    entries.append({k:body[k] for k in ['date','version','updatedAt']}|{'path':body['date']+'/'+body['version']+'.json','count':len(body['tickets'])})
                (directory/'manifest.json').write_text(json.dumps({'schemaVersion':'public-plus-money-manifest-1','editions':entries}))
            write(bodies);schema.publication_files(root,lambda r,n:r/n)
            for first in [None,'2026-10-28T18:00:00Z']:
                bad=copy.deepcopy(bodies[-1]);bad['firstPublishedAt']=first;bad.pop('version');bad['version']=schema.hashlib.sha256(schema.canonical(bad)).hexdigest()[:16]
                write(bodies[:2]+[bad])
                with self.assertRaisesRegex(ValueError,'clock cannot change or be cleared'):schema.publication_files(root,lambda r,n:r/n)
            write([bodies[1],bodies[0]])
            with self.assertRaisesRegex(ValueError,'chronological'):schema.publication_files(root,lambda r,n:r/n)
