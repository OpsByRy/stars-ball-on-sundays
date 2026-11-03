import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import public_schema as schema
class SavedPriceFacts(unittest.TestCase):
 def setUp(self):
  self.row={'book':'fanduel','americanOdds':-136,'capturedAt':'2026-11-02T22:30:00Z'}
  self.review={'status':'moved','book':'fanduel','americanOdds':-150,'providerAsOf':'2026-11-03T00:18:00Z','collectorObservedAt':'2026-11-03T00:20:24Z','checkedAt':'2026-11-03T00:28:27Z','sourceMatch':'exact_saved_contract'}
 def check(self):schema.validate_price_review(self.review,self.row)
 def test_valid_facts_do_not_mutate_prices(self):
  original=copy.deepcopy(self.row);self.check();self.assertEqual(original,self.row)
 def test_book_unknown_fields_and_authority_reject(self):
  for key,value in [('book','draftkings'),('qualification','qualifies'),('private_path','secret'),('status','closed')]:
   with self.subTest(key=key):
    old=copy.deepcopy(self.review);self.review[key]=value
    with self.assertRaises(ValueError):self.check()
    self.review=old
 def test_missing_has_no_invented_price_clock_or_match(self):
  self.review.update(status='not_found',americanOdds=None,providerAsOf=None,sourceMatch='identity_unresolved');self.check()
  for key,value in [('americanOdds',-150),('providerAsOf','2026-11-03T00:18:00Z'),('sourceMatch','exact_saved_contract')]:
   old=copy.deepcopy(self.review);self.review[key]=value
   with self.assertRaises(ValueError):self.check()
   self.review=old
 def test_invalid_prices_and_comparison_reject(self):
  for value in [True,float('nan'),0,-99,None,-136]:
   self.review['americanOdds']=value
   with self.assertRaises(ValueError):self.check()
 def test_timezone_and_order_required(self):
  for key,value in [('checkedAt',None),('checkedAt','2026-11-03T00:19:00Z'),('providerAsOf','2026-11-03T00:21:00Z'),('collectorObservedAt','2026-11-03T00:20:24')]:
   old=copy.deepcopy(self.review);self.review[key]=value
   with self.assertRaises(ValueError):self.check()
   self.review=old
 def test_unchanged_requires_equal_original_price(self):
  self.review.update(status='unchanged',americanOdds=-136);self.check();self.review['americanOdds']=-150
  with self.assertRaises(ValueError):self.check()
if __name__=='__main__':unittest.main()
