import copy, json, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from public_schema import validate_edition
from build import preserve_personal_slips, assert_personal_estimates

class SundayPersonalTicket(unittest.TestCase):
 def record(self):return json.loads((ROOT/'data/editions/sunday/2026-11-01/bb42e33e7a59f527.json').read_bytes())
 def test_exact_record_and_minute_precision_are_valid_without_model_estimates(self):
  b=self.record();validate_edition(b);assert_personal_estimates(b)
  self.assertEqual(b['personalSlips'][0]['placedAt'],'2026-11-01T12:33-05:00')
  self.assertEqual(len(b['props']),5);self.assertTrue(all('estimate'not in r and not r['selected'] for r in b['props']))
 def test_labels_are_bounded_nonempty_plain_text_and_do_not_widen_the_record(self):
  for value in ['', '   ', 'x'*81, 'line\nbreak', None, 42]:
   b=self.record();b['personalSlips'][0]['label']=value
   with self.subTest(value=value),self.assertRaises(ValueError):validate_edition(b)
  b=self.record();b['personalSlips'][0]['accountBalance']='excluded'
  with self.assertRaises(ValueError):validate_edition(b)
 def test_sensitive_fields_remain_rejected_at_all_personal_boundaries(self):
  for scope in ['edition','publication','slip','group','leg','row']:
   for field in ['accountBalance','balance','wager','stake','betId','bet_id']:
    b=self.record();s=b['personalSlips'][0];obj={'edition':b,'publication':b['personalPublication'],'slip':s,'group':s['groups'][0],'leg':s['legs'][0],'row':b['props'][0]}[scope];obj[field]='excluded'
    with self.subTest(scope=scope,field=field),self.assertRaises(ValueError):validate_edition(b)
 def test_later_quote_or_recording_time_cannot_replace_original_group_provenance(self):
  b=self.record();b['personalSlips'][0]['priceEvidence']['context']='later_quote'
  with self.assertRaises(ValueError):validate_edition(b)
  b=self.record();b['personalSlips'][0]['groups'][0]['priceEvidence']['observedAt']='2099-11-01T12:33-05:00'
  with self.assertRaises(ValueError):validate_edition(b)
 def test_posting_amendment_preserves_ticket_quotes_groups_and_recorded_clock(self):
  b=self.record();state={};preserve_personal_slips(b,state);later=copy.deepcopy(b)
  later['personalPublication']['publishedAt']='2026-11-01T18:00:00Z'
  for r in later['props']:r['postedAt']=later['personalPublication']['publishedAt']
  preserve_personal_slips(later,state);validate_edition(later)
  for field,value in [('americanOdds',531),('label','Changed identity')]:
   changed=copy.deepcopy(later);changed['personalSlips'][0][field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):preserve_personal_slips(changed,state)
