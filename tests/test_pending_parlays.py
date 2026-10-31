from pathlib import Path
from datetime import datetime,timezone
import copy,hashlib,json,sys,tempfile,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from pending_parlays import verify_pending_parlays
from build import canonical
class PendingParlays(unittest.TestCase):
 def test_pregame_boundary_and_posting_clock_cleanup(self):
  with tempfile.TemporaryDirectory() as d:
   r=Path(d);(r/'data/plus-money/2026-10-31').mkdir(parents=True);identity='a'*16
   body={'date':'2026-10-31','tickets':[{'id':identity,'selectedAt':'2026-10-31T20:35:00Z','postedAt':None,'legs':[{'startTime':'2026-10-31T22:00:00Z'}]}]};version=hashlib.sha256(canonical(body)).hexdigest()[:16];body['version']=version;name=f'2026-10-31/{version}.json';(r/'data/plus-money'/name).write_text(json.dumps(body));(r/'data/plus-money/manifest.json').write_text(json.dumps({'editions':[{'channel':'daily','date':'2026-10-31','version':version,'path':name}]}));marker=r/'pending-parlays.json';m={'schemaVersion':'sbos-pending-pregame-parlays-1','date':'2026-10-31','editionVersion':version,'ticketIds':[identity]};marker.write_text(json.dumps(m))
   self.assertIn('not a deadline',verify_pending_parlays(r,datetime(2026,10,31,21,59,tzinfo=timezone.utc)))
   for instant in ['2026-10-31T22:00:00+00:00','2026-11-01T01:00:00+00:00']:
    with self.assertRaisesRegex(ValueError,'at or after a leg tip'):verify_pending_parlays(r,datetime.fromisoformat(instant))
   bad={**m,'ticketIds':['b'*16]};marker.write_text(json.dumps(bad))
   with self.assertRaisesRegex(ValueError,'new unposted'):verify_pending_parlays(r,datetime(2026,10,31,21,tzinfo=timezone.utc))
   marker.unlink();self.assertIn('no unverified',verify_pending_parlays(r,datetime(2026,11,1,tzinfo=timezone.utc)))
if __name__=='__main__':unittest.main()
