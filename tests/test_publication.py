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

class PublicationBoundary(unittest.TestCase):
    def edition(self):
        index=json.loads((ROOT/'data/editions/manifest.json').read_text())
        return json.loads((ROOT/'data/editions'/index['editions'][0]['path']).read_text())

    def test_real_publications_and_digests_validate(self):
        self.assertGreater(len(build.publication_files(ROOT)),3)

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
