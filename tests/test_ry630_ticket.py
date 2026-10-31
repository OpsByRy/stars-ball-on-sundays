import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from public_schema import validate_edition
from build import assert_personal_estimates
class Ry630Boundary(unittest.TestCase):
 def body(self):return json.loads((ROOT/'data/editions/daily/2026-10-31/7d5c2b47eb40c3ff.json').read_text())
 def test_unknown_components_allowed_but_invalid_values_rejected(self):
  b=self.body();validate_edition(b)
  for price in [0,99,'-166',True]:
   c=copy.deepcopy(b);c['personalSlips'][0]['legs'][0]['americanOdds']=price
   with self.assertRaises(ValueError):validate_edition(c)
 def test_group_membership_is_exact_and_cannot_mix_games_or_duplicate_legs(self):
  for mode in ['wrong-event','duplicate','missing','size','private']:
   b=self.body();s=b['personalSlips'][0]
   if mode=='wrong-event':s['groups'][0]['canonicalEventId']='nba:0000000000'
   elif mode=='duplicate':s['groups'][1]['pickIds'][0]=s['groups'][0]['pickIds'][0]
   elif mode=='missing':s['groups'].pop()
   elif mode=='size':s['groups'][0]['kind']='standalone'
   else:s['groups'][0]['stake']=10
   with self.assertRaises(ValueError):validate_edition(b)
 def test_research_and_original_forecasts_remain_identical(self):
  prior=json.loads((ROOT/'data/editions/daily/2026-10-31/a6d49ddcbb18e732.json').read_text())
  self.assertEqual(self.body()['props'][:6753],prior['props'])
 def test_explicit_user_tracking_publishes_without_inventing_a_model_estimate(self):
  b=self.body();assert_personal_estimates(b)
  r=next(r for r in b['props'] if r['group']=='ry');r['sourceType']='saved sportsbook observation'
  with self.assertRaisesRegex(ValueError,'reviewed probabilities'):assert_personal_estimates(b)
  r['sourceType']='user_supplied_unsubmitted_favorite';r['estimate']={'winProbability':.9}
  with self.assertRaisesRegex(ValueError,'reviewed probabilities'):assert_personal_estimates(b)
