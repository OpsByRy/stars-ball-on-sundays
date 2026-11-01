import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from public_schema import validate_edition
from build import preserve_personal_slips

class FavoritesPriceEvidence(unittest.TestCase):
 def record(self):return json.loads((ROOT/'data/editions/daily/2026-10-31/7d5c2b47eb40c3ff.json').read_text())
 def quoted(self):
  b=self.record();s=b['personalSlips'][0];s['shareUrl']='https://sportsbook.fanduel.com/addToBetslip?shareCode=Example'
  e={'source':'share_link','context':'original_slip','observedAt':b['personalPublication']['recordedAt']}
  s['groups'][0].update(americanOdds=135,priceEvidence=copy.deepcopy(e))
  s['legs'][0].update(americanOdds=-155,priceEvidence=copy.deepcopy(e))
  s['priceEvidence']=copy.deepcopy(e)
  return b
 def test_original_and_later_component_evidence_can_be_preserved_without_changing_original_full_price(self):
  b=self.quoted();validate_edition(b)
  b['personalSlips'][0]['groups'][0]['priceEvidence']['context']='later_quote'
  b['personalSlips'][0]['legs'][0]['priceEvidence']['context']='later_quote'
  validate_edition(b);self.assertEqual(b['personalSlips'][0]['americanOdds'],630)
 def test_group_price_requires_exact_group_and_complete_price_evidence(self):
  for mode in ['missing-evidence','bad-source','bad-context','no-time','future-time','private-field','wrong-group','standalone-price','invalid-odds']:
   with self.subTest(mode=mode):
    b=self.quoted();g=b['personalSlips'][0]['groups'][0]
    if mode=='missing-evidence':del g['priceEvidence']
    elif mode=='bad-source':g['priceEvidence']['source']='guessed'
    elif mode=='bad-context':g['priceEvidence']['context']='assumed'
    elif mode=='no-time':g['priceEvidence']['observedAt']=None
    elif mode=='future-time':g['priceEvidence']['observedAt']='2026-11-01T12:00:00Z'
    elif mode=='private-field':g['priceEvidence']['accountId']='private'
    elif mode=='wrong-group':g['pickIds'][0]='missing'
    elif mode=='standalone-price':b['personalSlips'][0]['groups'][2].update(americanOdds=150,priceEvidence=copy.deepcopy(g['priceEvidence']))
    else:g['americanOdds']=50
    with self.assertRaises(ValueError):validate_edition(b)
 def test_share_link_must_match_allowed_public_slip_url_and_cannot_substitute_for_original_price(self):
  for mode in ['missing-link','other-host','extra-query','later-full-price']:
   b=self.quoted();s=b['personalSlips'][0]
   if mode=='missing-link':del s['shareUrl']
   elif mode=='other-host':s['shareUrl']='https://example.com/addToBetslip?shareCode=Example'
   elif mode=='extra-query':s['shareUrl']+='&accountId=private'
   else:s['priceEvidence']['context']='later_quote'
   with self.assertRaises(ValueError):validate_edition(b)
 def test_observation_and_source_metadata_stay_immutable_across_result_editions(self):
  b=self.quoted();state={};preserve_personal_slips(b,state)
  for mode in ['group-price','observation','share-link']:
   later=copy.deepcopy(b);s=later['personalSlips'][0]
   if mode=='group-price':s['groups'][0]['americanOdds']=140
   elif mode=='observation':s['groups'][0]['priceEvidence']['observedAt']='2026-10-31T21:50:00Z'
   else:s['shareUrl']='https://sportsbook.fanduel.com/addToBetslip?shareCode=Different'
   with self.assertRaises(ValueError):preserve_personal_slips(later,state)
  later=copy.deepcopy(b)
  for row in later['props']:
   if row['group']=='ry':row['result']={'eventStatus':'final','statisticalOutcome':'loss','actual':0}
  preserve_personal_slips(later,state);validate_edition(later)

if __name__=='__main__':unittest.main()
