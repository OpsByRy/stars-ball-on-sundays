import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import build
import sgp_research_schema as schema

def read(path):
    return json.loads(Path(path).read_bytes())

def seal(body):
    body['version'] = hashlib.sha256(schema.canonical({k:v for k,v in body.items() if k != 'version'})).hexdigest()[:16]
    return body

class SGPResearchContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.entry = next(e for e in read(ROOT/'data/sgp-research/manifest.json')['editions'] if e['date'] == '2026-11-06')
        cls.body = read(ROOT/'data/sgp-research'/cls.entry['path'])
        cls.source = read(ROOT/'data/editions'/cls.body['sourceDaily']['path'])
        cls.calculator_sha = hashlib.sha256((ROOT/'assets/sgp-math.js').read_bytes()).hexdigest()

    def check(self, body):
        return schema.validate(body, source=self.source, calculator_sha=self.calculator_sha)

    def test_actual_eight_and_all_original_objects(self):
        b = copy.deepcopy(self.body)
        self.assertEqual(len(self.check(b)['suggestions']), 8)
        originals = {p['id']:p for p in self.source['props']}
        legs = [l for a in b['suggestions'] for l in a['legs']]
        self.assertEqual(len(legs),23)
        self.assertEqual(len({l['pick']['id'] for l in legs}),5)
        for leg in legs:
            self.assertEqual(leg['pick'], originals[leg['pick']['id']])
        self.assertEqual(b,self.body)

    def test_manifest_is_the_only_build_entry_and_both_new_files_are_packaged(self):
        names = schema.publication_files(ROOT,build.safe_file)
        self.assertEqual(names,['data/sgp-research/manifest.json','data/sgp-research/'+self.entry['path']])
        self.assertEqual(hashlib.sha256((ROOT/names[1]).read_bytes()).hexdigest(),self.entry['sha256'])

    def test_rejects_financial_private_quote_probability_and_score_fields(self):
        changes = [
            lambda b:b.update(private_source_path='/private/source'),
            lambda b:b['suggestions'][0].update(stake=10),
            lambda b:b['suggestions'][0].update(roi=.5),
            lambda b:b['suggestions'][0].update(combinedQuote={'americanOdds':500}),
            lambda b:b['suggestions'][0].update(jointWinProbability=.5),
            lambda b:b['suggestions'][0].update(ticketEV=.2),
            lambda b:b['suggestions'][0].update(betReady=True),
            lambda b:b['suggestions'][0]['compatibility'].update(metric=80),
            lambda b:b['suggestions'][0]['compatibility'].update(selectionUse='qualification'),
            lambda b:b['suggestions'][0]['legs'][0].update(features={'private':1}),
        ]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                b=copy.deepcopy(self.body);change(b);seal(b)
                with self.assertRaises(ValueError):self.check(b)

    def test_unknown_context_cannot_be_promoted(self):
        for key,value in [('availability','available'),('role','confirmed'),('settlementTerms','verified')]:
            with self.subTest(key=key):
                b=copy.deepcopy(self.body);b['suggestions'][0]['legs'][0][key]=value;seal(b)
                with self.assertRaises(ValueError):self.check(b)

    def test_original_provider_and_forecast_clocks_are_required(self):
        for change in [
            lambda l:l.update(providerAsOf=None),
            lambda l:l.update(providerAsOf='2099-11-06T12:00:00Z'),
            lambda l:l.update(forecastCutoff='2099-11-06T12:00:00Z'),
            lambda l:l['pick'].update(capturedAt='2099-11-06T12:00:00Z'),
        ]:
            b=copy.deepcopy(self.body);change(b['suggestions'][0]['legs'][0]);seal(b)
            with self.assertRaises(ValueError):self.check(b)

    def test_future_physical_clock_chain_is_rejected_even_when_self_consistent(self):
        for keys in [('assembledAt',),('sourceSelectionAt','nominatedAt','assembledAt')]:
            b=copy.deepcopy(self.body)
            for key in keys:b[key]='2099-11-06T12:00:00Z'
            seal(b)
            with self.assertRaises(ValueError):self.check(b)

    def test_integrity_and_unsafe_paths_are_rejected(self):
        b=copy.deepcopy(self.body);b['version']='0'*16
        with self.assertRaises(ValueError):self.check(b)
        b=copy.deepcopy(self.body);b['sourceDaily']['path']='../../private.json';seal(b)
        with self.assertRaises(ValueError):self.check(b)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'duplicate.json';p.write_text('{"a":1,"a":2}')
            with self.assertRaises(ValueError):schema.read(p)

    def test_group_and_book_identity_cannot_change(self):
        for change in [
            lambda b:b['suggestions'][0].update(kind='sgp_plus'),
            lambda b:b['suggestions'][0].update(priceSources='fanduel'),
            lambda b:b['suggestions'][0]['legs'][0]['pick'].update(eventId='nba:0022600999'),
            lambda b:b['suggestions'][0]['legs'][0]['pick'].update(playerId='nba:9999999'),
        ]:
            b=copy.deepcopy(self.body);change(b);seal(b)
            with self.assertRaises(ValueError):self.check(b)

    def test_repeated_membership_and_conflicting_copies_cannot_inflate_records(self):
        b=copy.deepcopy(self.body);b['suggestions'][1]=copy.deepcopy(b['suggestions'][0]);b['suggestions'][1]['id']='sgp-research-2026-11-06-'+'f'*16;seal(b)
        with self.assertRaises(ValueError):self.check(b)
        b=copy.deepcopy(self.body);b['suggestions'][2]['legs'][0]['pick']['americanOdds']=-201;seal(b)
        with self.assertRaises(ValueError):self.check(b)

    def test_resealed_and_repriced_payload_still_must_match_immutable_daily(self):
        b=copy.deepcopy(self.body);target=b['suggestions'][0]['legs'][0]['pick']['id']
        for a in b['suggestions']:
            for leg in a['legs']:
                if leg['pick']['id']==target:leg['pick']['americanOdds']=-201
            decimal=math.prod(1+(l['pick']['americanOdds']/100 if l['pick']['americanOdds']>0 else 100/abs(l['pick']['americanOdds'])) for l in a['legs'])
            a['straightOddsBenchmark']['decimalOdds']=decimal
            a['straightOddsBenchmark']['americanOdds']=math.floor(((decimal-1)*100 if decimal>=2 else -100/(decimal-1))+.5)
        seal(b)
        schema.validate(b,calculator_sha=self.calculator_sha)  # self-consistent is not source authority
        with self.assertRaises(ValueError):self.check(b)

    def test_benchmark_is_optional_but_cannot_be_mislabeled_or_fabricated(self):
        b=copy.deepcopy(self.body)
        for a in b['suggestions']:a['straightOddsBenchmark']=None
        seal(b);self.assertEqual(len(self.check(b)['suggestions']),8)
        for key,value in [('method','sgp_fair_price'),('americanOdds',999999),('calculatorSHA256','0'*64)]:
            b=copy.deepcopy(self.body);b['suggestions'][0]['straightOddsBenchmark'][key]=value;seal(b)
            with self.assertRaises(ValueError):self.check(b)

    def test_the_original_daily_and_priced_parlay_records_remain_unchanged(self):
        self.assertEqual(hashlib.sha256((ROOT/'data/editions'/self.body['sourceDaily']['path']).read_bytes()).hexdigest(),'c35b59834620800e597f5cb794d83483ba28c890f6c6e8ae8d49f2ae6a98abf1')
        p=ROOT/'data/plus-money/2026-11-06/eccafc0d8adb30dd.json'
        self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),'07d5aa082b3a83e8919407845b6275611aa81af8e98bfd27622692ce3cc6d755')
        self.assertEqual(len(read(p)['tickets']),3)
        self.assertNotIn('sgp_research_suggestion',p.read_text())

if __name__=='__main__':
    unittest.main()
