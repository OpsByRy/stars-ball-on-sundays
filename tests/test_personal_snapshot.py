import copy, json, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from public_schema import validate_edition
from build import personal_price_view

entries=[e for e in json.loads((ROOT/'data/editions/manifest.json').read_text())['editions'] if e['channel']=='daily' and e['date']=='2026-11-01']
records=[json.loads((ROOT/'data/editions'/e['path']).read_text()) for e in entries]
first=next(i for i,b in enumerate(records) if any(s.get('recordKind')=='selection_snapshot' and s.get('label')=='Run It Back' for s in b.get('personalSlips',[])))
assert first>0
SNAPSHOT,PREVIOUS=records[first],records[first-1]

class PersonalSnapshot(unittest.TestCase):
 def record(self):return copy.deepcopy(SNAPSHOT)
 def test_snapshot_preserves_research_and_unknown_clocks_without_component_prices(self):
  body=self.record();validate_edition(body)
  old=PREVIOUS
  self.assertEqual(body['props'][:-4],old['props'])
  slip=body['personalSlips'][0]
  self.assertEqual(slip['americanOdds'],467);self.assertIsNone(slip['placedAt']);self.assertIsNone(slip['priceEvidence']['observedAt'])
  self.assertEqual([r['americanOdds'] for r in slip['legs']],[None]*4)
  self.assertEqual([r['ryFavorite'] for r in body['props'][-4:]],[False]*4)
  self.assertEqual([r['selected'] for r in body['props'][-4:]],[False]*4)
  self.assertNotIn('groups',slip);self.assertNotIn('shareUrl',slip)
  self.assertTrue(all('estimate' not in r and r['capturedAt'] is None for r in body['props'][-4:]))
 def test_nullable_clock_requires_the_entire_recognized_full_ticket_shape(self):
  for key in ['recordKind','quoteBasis','oddsChangedAtCapture','priceEvidence']:
   body=self.record();del body['personalSlips'][0][key]
   with self.assertRaises(ValueError,msg=key):validate_edition(body)
  for value in [None,[],False]:
   body=self.record();body['personalSlips'][0]['priceEvidence']=value
   with self.assertRaises(ValueError):validate_edition(body)
  for key,value in [('recordKind','other'),('quoteBasis','boosted'),('oddsChangedAtCapture','true'),('placedAt','2026-11-01T22:00:00Z'),('shareUrl','https://sportsbook.fanduel.com/addToBetslip?shareCode=example'),('groups',[])]:
   body=self.record();body['personalSlips'][0][key]=value
   with self.assertRaises(ValueError,msg=key):validate_edition(body)
 def test_legs_and_legacy_evidence_cannot_use_the_clock_exception(self):
  body=self.record();body['personalSlips'][0]['legs'][0].update(americanOdds=-245,priceEvidence=copy.deepcopy(body['personalSlips'][0]['priceEvidence']))
  with self.assertRaises(ValueError):validate_edition(body)
  for source,context in [('screenshot','original_slip'),('share_link','original_slip'),('screenshot','later_quote')]:
   body=self.record();s=body['personalSlips'][0]
   for k in ['recordKind','quoteBasis','oddsChangedAtCapture']:del s[k]
   s['priceEvidence'].update(source=source,context=context)
   with self.assertRaises(ValueError):validate_edition(body)
 def test_snapshot_membership_does_not_grant_individual_endorsement_or_a_model_selection(self):
  for key,value in [('ryFavorite',True),('selected',True),('sourceType','legacy'),('estimate',{'winProbability':.9})]:
   body=self.record();body['props'][-1][key]=value
   with self.assertRaises(ValueError):validate_edition(body)
 def test_snapshot_is_not_an_original_personal_financial_tracking_quote(self):
  quotes=personal_price_view(ROOT)['data/personal-tracking-prices.json']['tickets']
  self.assertFalse(any(q['ticketId']=='ry-2026-11-01-02' for q in quotes))
  self.assertTrue(any(q['ticketId']=='ry-2026-11-01-01' and q['americanOdds']==530 for q in quotes))
