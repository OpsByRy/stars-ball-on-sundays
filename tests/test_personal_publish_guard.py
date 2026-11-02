import copy, hashlib, json, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build import assert_personal_estimates, assert_publication_time, canonical
from public_schema import validate_edition

def read(name):return json.loads((ROOT/name).read_text())
entries=read('data/editions/manifest.json')['editions']
snapshot=next(read('data/editions/'+e['path']) for e in entries if e['channel']=='daily' and e['date']=='2026-11-01' and any(s.get('recordKind')=='selection_snapshot' for s in read('data/editions/'+e['path']).get('personalSlips',[])))

class PersonalPublishGuard(unittest.TestCase):
 def record(self):
  body=copy.deepcopy(snapshot)
  body['props']=[r for r in body['props'] if r['group']=='ry']
  body.pop('version',None);body['version']=hashlib.sha256(canonical(body)).hexdigest()[:16]
  validate_edition(body)
  return body

 def test_exact_publish_guards_accept_valid_snapshot_without_inventing_estimates(self):
  body=self.record();before=copy.deepcopy(body);now=datetime.now(timezone.utc)
  # Exercise the real publication clock; never replace it with a convenient time.
  eastern=now.astimezone(ZoneInfo('America/New_York'))
  scheduled=[{'channel':'daily','date':body['date']}]
  if body['date']>eastern.date().isoformat() or body['date']==eastern.date().isoformat() and eastern.hour<10:
   with self.assertRaisesRegex(ValueError,'cannot publish before'):assert_publication_time(scheduled,now)
  else:assert_publication_time(scheduled,now)
  assert_personal_estimates(body)
  self.assertEqual(body,before)
  self.assertTrue(all(r.get('estimate') is None and r['selected'] is False and r['ryFavorite'] is False for r in body['props']))

 def test_row_marker_without_a_recognized_ticket_cannot_bypass_model_guard(self):
  body=self.record();body.pop('personalSlips');body.pop('personalPublication')
  with self.assertRaisesRegex(ValueError,'require reviewed probabilities'):assert_personal_estimates(body)

 def test_complete_edition_validation_is_required_not_only_ticket_references(self):
  body=self.record();body['props'][0]['unreviewed_field']='not allowed'
  with self.assertRaisesRegex(ValueError,'unknown'):assert_personal_estimates(body)
  for key,value in [('selected',True),('ryFavorite',True),('estimate',{'winProbability':.9})]:
   body=self.record();body['props'][0][key]=value
   with self.assertRaises(ValueError):assert_personal_estimates(body)

 def test_snapshot_metadata_or_component_price_cannot_weaken_the_exception(self):
  for key in ['recordKind','priceEvidence','quoteBasis','oddsChangedAtCapture']:
   body=self.record();del body['personalSlips'][0][key]
   with self.assertRaises(ValueError):assert_personal_estimates(body)
  body=self.record();body['personalSlips'][0]['legs'][0]['americanOdds']=-245
  with self.assertRaises(ValueError):assert_personal_estimates(body)

 def test_model_personal_rows_in_a_mixed_edition_still_require_reviewed_estimates(self):
  body=self.record();rows=[]
  for index in [1,2]:
   row=copy.deepcopy(body['props'][0]);row.update(id='legacy-control-'+str(index),sourceType='model_personal_control',ryFavorite=True)
   rows.append(row)
  body['props'].extend(rows)
  body['personalSlips'].append({'id':'ry-'+body['date']+'-99','book':'fanduel','americanOdds':120,'placedAt':None,'ryFavorite':True,'legs':[{'pickId':r['id'],'americanOdds':None} for r in rows]})
  validate_edition(body)
  with self.assertRaisesRegex(ValueError,'require reviewed probabilities'):assert_personal_estimates(body)
  estimate={'winProbability':.7,'pushProbability':0,'lossProbability':.3,'projection':25,'asOf':'2026-10-29T12:00:00Z','status':'provisional'}
  for row in rows:row['estimate']=copy.deepcopy(estimate)
  assert_personal_estimates(body)

 def test_existing_legacy_records_and_real_clock_restrictions_are_preserved(self):
  assert_personal_estimates(read('data/editions/daily/2026-10-30/3c26a5cf7d231094.json'))
  sunday=next(e for e in reversed(entries) if e['channel']=='sunday' and e['date']=='2026-11-01')
  assert_personal_estimates(read('data/editions/'+sunday['path']))
  now=datetime.now(timezone.utc)
  tomorrow=(now.astimezone(ZoneInfo('America/New_York')).date()+timedelta(days=1)).isoformat()
  with self.assertRaisesRegex(ValueError,'cannot publish before'):assert_publication_time([{'channel':'daily','date':tomorrow}],now)
