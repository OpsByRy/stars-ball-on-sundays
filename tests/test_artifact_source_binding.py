"""Exercise the real host assembler against a deterministic build fixture."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build
import build_hosts as h
import coordinated_release as c


class ArtifactSourceBinding(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.site=self.root/'source';self.site.mkdir()
        self.policy=json.loads((Path(h.__file__).parents[1]/'hosting-policy.json').read_text())
        (self.site/'hosting-policy.json').write_text(json.dumps(self.policy))
        self.source='a'*40;self.artifact=self.root/'artifact'
        self.build_patch=patch.object(build,'build',side_effect=self.fixture_build);self.build_patch.start()
        baseline=self.root/'baseline';self.fixture_build(self.site,destination=baseline)
        h.assemble(baseline,self.artifact,self.root/'github',self.policy,self.source)
        self.receipt_path=self.artifact/'_sbos-release.json'
        receipt=json.loads(self.receipt_path.read_text());receipt['coordinatedRelease']={'status':'unchanged'}
        self.receipt_path.write_text(json.dumps(receipt))
    def tearDown(self):self.build_patch.stop();self.temp.cleanup()
    def fixture_build(self,root,publish=False,destination=None):
        destination.mkdir();(destination/'assets').mkdir()
        (destination/'data/editions').mkdir(parents=True)
        (destination/'data/editions/manifest.json').write_text('{"editions":[]}')
        (destination/'index.html').write_text('<html><script src="assets/app.js"></script></html>')
        (destination/'assets/app.js').write_text('globalThis.REVIEWED=true;')
        (destination/'assets/view.json').write_text('{"reviewed":true}')
    def rewrite_receipt(self):
        receipt=json.loads(self.receipt_path.read_text())
        receipt['files']={'/'+p.relative_to(self.artifact).as_posix():c.file_sha(p) for p in self.artifact.rglob('*') if p.is_file() and p!=self.receipt_path}
        self.receipt_path.write_text(json.dumps(receipt))
    def test_exact_rebuild_passes_without_replacing_existing_outputs(self):
        saved=self.site/'dist/keep';saved.parent.mkdir();saved.write_text('existing output')
        c.verify_artifact_source(self.site,self.artifact,self.source)
        self.assertEqual(saved.read_text(),'existing output')
    def test_rewritten_assets_or_generated_files_and_receipt_are_rejected(self):
        for name in ('index.html','assets/app.js','assets/view.json','404.html','_headers'):
            with self.subTest(name=name):
                target=self.artifact/name;original=target.read_bytes()
                target.write_text('unreviewed content');self.rewrite_receipt()
                with self.assertRaisesRegex(ValueError,'independently rebuilt source'):
                    c.verify_artifact_source(self.site,self.artifact,self.source)
                target.write_bytes(original);self.rewrite_receipt()
    def test_added_asset_and_rewritten_receipt_are_rejected(self):
        (self.artifact/'extra.js').write_text('unreviewed content');self.rewrite_receipt()
        with self.assertRaisesRegex(ValueError,'independently rebuilt source'):
            c.verify_artifact_source(self.site,self.artifact,self.source)


if __name__=='__main__':unittest.main()
