import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from public_schema import validate_edition
from build import personal_price_view

class PersonalSlipsBoundary(unittest.TestCase):
 def record(self):return json.loads((ROOT/'data/editions/daily/2026-10-30/3c26a5cf7d231094.json').read_text())
 def test_exact_quotes_and_legacy_safe_derived_prices(self):
  b=self.record();validate_edition(b);view=personal_price_view(ROOT)['data/personal-tracking-prices.json']['tickets'];quotes={r['ticketId']:r['americanOdds'] for r in view}
  self.assertEqual([quotes[s['id']] for s in b['personalSlips']],[447,125,294,109,125]);self.assertTrue(any(r['ticketId'].startswith('ry:') for r in view))
 def test_unknown_financial_and_private_fields_fail_at_every_new_boundary(self):
  for target in ['publication','slip','leg']:
   b=self.record();obj=b['personalPublication'] if target=='publication' else b['personalSlips'][0] if target=='slip' else b['personalSlips'][0]['legs'][0]
   for field in ['stake','accountId','balance','private_coefficients']:
    obj[field]=25
    with self.assertRaisesRegex(ValueError,'unknown'):validate_edition(b)
    del obj[field]
 def test_duplicate_missing_unattributed_and_research_leg_references_are_rejected(self):
  for mode in ['duplicate-slip','duplicate-leg','missing','research','unattributed']:
   b=self.record()
   if mode=='duplicate-slip':b['personalSlips'].append(copy.deepcopy(b['personalSlips'][0]))
   elif mode=='duplicate-leg':b['personalSlips'][0]['legs'].append(copy.deepcopy(b['personalSlips'][0]['legs'][0]))
   elif mode=='missing':b['personalSlips'][0]['legs'][0]['pickId']='missing'
   elif mode=='research':b['personalSlips'][0]['legs'][0]['pickId']=next(r['id'] for r in b['props'] if r['group']=='research')
   else:b['props'].append({**next(r for r in b['props'] if r['group']=='ry'),'id':'unused'})
   with self.assertRaises(ValueError):validate_edition(b)
 def test_posting_and_placement_times_cannot_be_confused_or_backdated(self):
  b=self.record();b['personalPublication']['publishedAt']='2026-10-30T19:00:00Z'
  with self.assertRaisesRegex(ValueError,'precedes recording'):validate_edition(b)
  b=self.record();b['personalSlips'][0]['placedAt']='2026-10-31T03:00:00Z'
  with self.assertRaisesRegex(ValueError,'placement follows'):validate_edition(b)
  b=self.record();b['personalPublication']['publishedAt']='2026-10-31T00:20:00Z'
  with self.assertRaisesRegex(ValueError,'publication time mismatch'):validate_edition(b)
  for r in b['props']:
   if r['group']=='ry':r['postedAt']=b['personalPublication']['publishedAt']
  validate_edition(b)
 def test_new_slips_cannot_fall_back_to_one_legacy_combined_parlay(self):
  for field,value in [('sharedBetslipOdds',125),('sharedBetslipUrl','https://sportsbook.fanduel.com/addToBetslip?shareCode=abc'),('favoritesPostedAt','2026-10-30T23:55:00Z')]:
   b=self.record();b[field]=value
   with self.assertRaisesRegex(ValueError,'legacy slip'):validate_edition(b)
 def test_future_algorithm_and_results_editions_cannot_drop_or_reprice_personal_slips(self):
  from build import preserve_personal_slips
  for mode in ['drop','reprice','contract','remove-one']:
   b=self.record();state={};preserve_personal_slips(b,state);later=copy.deepcopy(b)
   if mode=='drop':del later['personalSlips']
   elif mode=='reprice':later['personalSlips'][3]['legs'][1]['americanOdds']=-122
   elif mode=='contract':next(r for r in later['props'] if r['group']=='ry')['line']=99
   else:later['personalSlips'].pop()
   with self.assertRaises(ValueError):preserve_personal_slips(later,state)
 def test_statistical_updates_and_one_verified_publication_stamp_preserve_personal_history(self):
  from build import preserve_personal_slips
  b=self.record();state={};preserve_personal_slips(b,state);later=copy.deepcopy(b);later['personalPublication']['publishedAt']='2026-10-31T00:20:00Z'
  for r in later['props']:
   if r['group']=='ry':r['postedAt']=later['personalPublication']['publishedAt'];r['result']={'eventStatus':'live','statisticalOutcome':'pending'}
  preserve_personal_slips(later,state);validate_edition(later)
  for altered in [None,'2026-10-31T00:21:00Z']:
   changed=copy.deepcopy(later);changed['personalPublication']['publishedAt']=altered
   with self.assertRaisesRegex(ValueError,'clock'):preserve_personal_slips(changed,state)
