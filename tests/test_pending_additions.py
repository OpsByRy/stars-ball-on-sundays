from pathlib import Path
from datetime import datetime,timezone
import copy,hashlib,json,sys,tempfile,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from pending_additions import verify_pending_additions
from build import canonical
class PendingAdditions(unittest.TestCase):
 def test_pregame_boundary_and_posting_clock_cleanup(self):
  with tempfile.TemporaryDirectory() as d:
   r=Path(d);(r/'data/editions/daily/2026-10-31').mkdir(parents=True);identity='a'*64
   body={'channel':'daily','date':'2026-10-31','props':[{'id':identity,'group':'research','category':'value_safe','selected':True,'postedAt':None,'startTime':'2026-10-31T22:00:00Z','capturedAt':'2026-10-31T20:00:00Z'}]};version=hashlib.sha256(canonical(body)).hexdigest()[:16];body['version']=version;name=f'daily/2026-10-31/{version}.json';(r/'data/editions'/name).write_text(json.dumps(body));(r/'data/editions/manifest.json').write_text(json.dumps({'editions':[{'channel':'daily','date':'2026-10-31','version':version,'path':name}]}));marker=r/'pending-additions.json';m={'schemaVersion':'sbos-pending-pregame-additions-1','date':'2026-10-31','editionVersion':version,'pickIds':[identity]};marker.write_text(json.dumps(m))
   self.assertIn('not a deadline',verify_pending_additions(r,datetime(2026,10,31,21,59,tzinfo=timezone.utc)))
   for instant in ['2026-10-31T22:00:00+00:00','2026-11-01T01:00:00+00:00']:
    with self.assertRaisesRegex(ValueError,'at or after tip'):verify_pending_additions(r,datetime.fromisoformat(instant))
   bad={**m,'pickIds':['b'*64]};marker.write_text(json.dumps(bad))
   with self.assertRaisesRegex(ValueError,'only new unposted'):verify_pending_additions(r,datetime(2026,10,31,21,tzinfo=timezone.utc))
   marker.unlink();self.assertIn('no unverified',verify_pending_additions(r,datetime(2026,11,1,tzinfo=timezone.utc)))
if __name__=='__main__':unittest.main()
