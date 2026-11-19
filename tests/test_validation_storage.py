"""Results validation keeps the complete gates without duplicating the archive."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import build


class ValidationStorage(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='sbos-validation-test-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        shutil.copytree(ROOT/'scripts',self.root/'scripts',ignore=shutil.ignore_patterns('__pycache__'))
        (self.root/'assets').mkdir()
        for name in ['published-picks','published-parlays','pick-board','availability','math','result-utils']:
            shutil.copyfile(ROOT/'assets'/f'{name}.js',self.root/'assets'/f'{name}.js')
        self.entry=json.loads((ROOT/'data/editions/manifest.json').read_text())['editions'][0]
        self.name='data/editions/'+self.entry['path']
        self.archive=self.root/self.name
        self.archive.parent.mkdir(parents=True)
        shutil.copyfile(ROOT/self.name,self.archive)
        (self.root/'data/editions/manifest.json').write_text(json.dumps({'schemaVersion':'public-1','editions':[self.entry]}))
        (self.root/'data/stat-targets.json').write_text('{"schemaVersion":"public-1","targets":[]}')
        (self.root/'site-manifest.json').write_text('{"files":["index.html","assets/app.js"]}')
        (self.root/'assets/app.js').write_text('window.publicApp=true;\n')
        (self.root/'index.html').write_text('<a href="'+self.name+'">Saved edition</a><script src="assets/app.js"></script>')

    def test_every_gate_runs_without_replacing_an_existing_build_or_copying_archive_bytes(self):
        count=build.build(self.root)
        destination=self.root/'dist'
        before={p.relative_to(destination):p.read_bytes()for p in destination.rglob('*')if p.is_file()}
        original=self.archive.read_bytes();links_before=self.archive.stat().st_nlink
        self.assertNotEqual(self.archive.stat().st_ino,(destination/self.name).stat().st_ino)
        with patch.object(build.os,'link',wraps=build.os.link) as linked,patch.object(build.shutil,'copyfile',wraps=build.shutil.copyfile) as copied:
            self.assertEqual(build.build(self.root,validate_only=True),count)
        self.assertTrue(any(Path(call.args[0]).resolve()==self.archive.resolve() for call in linked.call_args_list))
        self.assertFalse(any(Path(call.args[0]).resolve()==self.archive.resolve() for call in copied.call_args_list))
        self.assertEqual(self.archive.read_bytes(),original)
        self.assertEqual(self.archive.stat().st_nlink,links_before)
        self.assertEqual({p.relative_to(destination):p.read_bytes()for p in destination.rglob('*')if p.is_file()},before)
        self.assertFalse(list(self.root.glob('.sbos-validate-*')))

    def test_corrupt_immutable_edition_is_rejected_in_both_modes(self):
        body=json.loads(self.archive.read_text());body['props'][0]['line']+=1
        self.archive.write_text(json.dumps(body))
        for mode in [False,True]:
            with self.subTest(validate_only=mode),self.assertRaisesRegex(ValueError,'digest'):
                build.build(self.root,validate_only=mode)
        self.assertFalse((self.root/'dist').exists())

    def test_unreviewed_link_fails_and_disposable_tree_is_removed(self):
        (self.root/'assets/private-canary.js').write_text('PRIVATE')
        (self.root/'index.html').write_text('<script src="assets/private-canary.js"></script>')
        archive_before=hashlib.sha256(self.archive.read_bytes()).hexdigest()
        for mode in [True,False]:
            with self.subTest(validate_only=mode),self.assertRaisesRegex(ValueError,'missing link'):
                build.build(self.root,validate_only=mode)
        self.assertFalse(list(self.root.glob('.sbos-validate-*')))
        self.assertEqual(hashlib.sha256(self.archive.read_bytes()).hexdigest(),archive_before)

    def test_exact_withdrawal_reference_still_requires_real_published_history(self):
        body=json.loads(self.archive.read_text());row=body['props'][0]
        key=json.dumps([row['date'],row.get('canonicalEventId',row['eventId']),row['playerId'],row['market'],row['operator'],row['line'],row.get('period','full_game'),row.get('product','sportsbook'),row.get('overtime')],separators=(',',':'))
        reason={'date':body['date'],'channel':body['channel'],'recordKind':'pick','key':key,'sourceVersion':body['version'],'recordedAt':self.entry['updatedAt'],'reasonCode':'reference_test','notice':'A nonexistent withdrawal must fail.'}
        (self.root/'data/pick-withdrawal-reasons.json').write_text(json.dumps({'schemaVersion':'public-pick-withdrawal-reasons-1','reasons':[reason]}))
        for mode in [False,True]:
            with self.subTest(validate_only=mode),self.assertRaisesRegex(ValueError,'Published history validation failed'):
                build.build(self.root,validate_only=mode)

    def test_protected_static_exports_remain_rejected(self):
        (self.root/'private-lab').mkdir();(self.root/'private-lab/index.html').write_text('PRIVATE')
        (self.root/'site-manifest.json').write_text('{"files":["index.html","private-lab/index.html"]}')
        with self.assertRaisesRegex(ValueError,'Protected Lab'):
            build.build(self.root,validate_only=True)

    def test_a_derived_view_cannot_write_through_an_archive_link(self):
        original=self.archive.read_bytes()
        with patch.object(build,'board_views',return_value={self.name:{'unsafe':'overwrite'}}):
            with self.assertRaisesRegex(ValueError,'cannot overwrite linked immutable'):
                build.build(self.root,validate_only=True)
        self.assertEqual(self.archive.read_bytes(),original)
        self.assertFalse(list(self.root.glob('.sbos-validate-*')))


if __name__=='__main__':unittest.main()
