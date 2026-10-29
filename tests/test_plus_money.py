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
        body=json.loads((ROOT/'data/plus-money'/index['editions'][-1]['path']).read_text())
        self.assertEqual(body['schemaVersion'],'public-plus-money-2');schema.validate(body)
        self.assertTrue(any(t['section']=='longshots' for t in body['tickets']))
        self.assertTrue(any(t['book']=='mixed' for t in body['tickets']))
        q=body['tickets'][0]['legs'][0]['bookPrices']['quotes'][0];q['private_coefficients']=[1]
        with self.assertRaisesRegex(ValueError,'unknown'):schema.validate(body)
