"""An index refresh must retain safe immutable log URLs, and reject tampered archives."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import build

class ArchivedGameLogs(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        index=json.loads((ROOT/'data/player-logs/index.json').read_text())
        entry=next(p for p in index['players'] if p['games']>1)
        body=json.loads((ROOT/'data/player-logs'/entry['path']).read_text())
        index.update(players=[entry],games=len({g['eventId'] for g in body['games']}),appearances=len(body['games']),dataThrough=entry['lastGameDate'])
        summary={k:index[k] for k in ('season','capturedAt','dataThrough','games','appearances')}
        summary.update(path=index['season']+'/index.json',players=1)
        self.write('catalog.json',dict(schemaVersion='public-game-log-catalog-1',seasons=[summary]))
        self.write('index.json',index);self.write(summary['path'],index);self.write(entry['path'],body)
        archived=copy.deepcopy(body);archived['games']=archived['games'][:-1]
        archived['version']=hashlib.sha256(build.canonical({k:v for k,v in archived.items() if k!='version'})).hexdigest()[:16]
        self.archive=f"{archived['season']}/{entry['nbaId']}/{archived['version']}.json"
        self.write(self.archive,archived)
    def write(self,path,body):
        target=self.root/'data/player-logs'/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(build.canonical(body))
    def test_older_snapshot_is_included_after_current_index_advances(self):
        self.assertIn('data/player-logs/'+self.archive,build.game_log_files(self.root))
    def test_archive_with_private_fields_or_changed_bytes_is_rejected(self):
        path=self.root/'data/player-logs'/self.archive;body=json.loads(path.read_bytes())
        body['private_feature']='must not ship';self.write(self.archive,body)
        with self.assertRaises(ValueError):build.game_log_files(self.root)
        body.pop('private_feature');body['games'][0]['stats']['PTS']+=1;self.write(self.archive,body)
        with self.assertRaisesRegex(ValueError,'digest'):build.game_log_files(self.root)
