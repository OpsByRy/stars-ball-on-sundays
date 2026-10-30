import copy,hashlib,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from plus_money_schema import validate,canonical
from test_sgp_model_boundary import target
from plus_money_schema import validate_model_targets
class ProspectiveTierBoundary(unittest.TestCase):
 def body(self,prices=(-250,-275),date='2026-10-30'):
  index=json.loads((ROOT/'data/plus-money/manifest.json').read_text());base=json.loads((ROOT/'data/plus-money'/index['editions'][0]['path']).read_text())
  t=copy.deepcopy(base['tickets'][0]);t.update(section='plus_money',book='draftkings');t['legs']=t['legs'][:2]
  for leg,price in zip(t['legs'],prices):leg.update(date=date,americanOdds=price,book='draftkings');leg.pop('bookPrices',None)
  d=1
  for p in prices:d*=1+(p/100 if p>0 else 100/abs(p))
  t['indicativeAmericanOdds']=round((d-1)*100 if d>=2 else -100/(d-1))
  base.update(schemaVersion='public-plus-money-2',date=date,tickets=[t]);self.rehash(base);return base
 def rehash(self,b):b['version']=hashlib.sha256(canonical({k:v for k,v in b.items() if k!='version'})).hexdigest()[:16]
 def test_negative_crossgame_floor_is_prospective_and_price_product_remains_exact(self):
  b=self.body();self.assertEqual(b['tickets'][0]['indicativeAmericanOdds'],-110);validate(b)
  for bad in [self.body((-250,-280)),self.body(date='2026-10-29')]:
   with self.assertRaises(ValueError):validate(bad)
  b['tickets'][0]['indicativeAmericanOdds']=-100;self.rehash(b)
  with self.assertRaisesRegex(ValueError,'price mismatch'):validate(b)
 def test_twelve_per_new_price_tier_is_enforced(self):
  b=self.body();t=b['tickets'][0];b['tickets']=[{**copy.deepcopy(t),'id':str(i)} for i in range(12)];self.rehash(b);validate(b)
  b['tickets'].append({**copy.deepcopy(t),'id':'13'});self.rehash(b)
  with self.assertRaisesRegex(ValueError,'one prospective price tier'):validate(b)
 def test_sgp_target_floor_does_not_change_historical_fair_odds_or_claim_a_quote(self):
  t=target();validate_model_targets([t],'2026-10-29')
  for leg in t['legs']:leg.update(date='2026-10-30',startTime='2026-10-31T00:00:00Z')
  with self.assertRaisesRegex(ValueError,'floor'):validate_model_targets([t],'2026-10-30')
  t['jointEstimate']['minimumAmericanOdds']=-110;validate_model_targets([t],'2026-10-30');self.assertEqual(t['jointEstimate']['fairAmericanOdds'],-456)
