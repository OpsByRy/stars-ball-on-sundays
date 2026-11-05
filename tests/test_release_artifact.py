import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import release_artifact as artifact


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.output = self.root / 'sealed'
        self.sha = 'a' * 40
        for name in artifact.ROOTS:
            host = self.source / name
            host.mkdir(parents=True)
            (host / 'index.html').write_text('unchanged')
            (host / '.nojekyll').touch()
        (self.source / 'dist-cloudflare/_headers').write_text('/*\n  X-Content-Type-Options: nosniff\n')
        (self.source / 'dist-cloudflare/_sbos-release.json').write_text(json.dumps({'sourceSHA': self.sha}))

    def seal(self):
        return artifact.seal(self.source, self.output, self.sha)['manifestSHA256']

    def test_roundtrip_and_comparison(self):
        digest = self.seal()
        self.assertEqual(artifact.verify(self.output, self.sha, digest)['fileCount'], 6)
        self.assertTrue(artifact.compare(self.source, self.output)['equivalent'])

    def test_every_mutation_is_rejected(self):
        for mutation in ('add', 'remove', 'html', 'headers', 'marker', 'dotfile', 'github'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / 'artifact'
                digest = artifact.seal(self.source, out, self.sha)['manifestSHA256']
                paths = {'add':'dist-cloudflare/extra', 'remove':'dist-cloudflare/index.html',
                         'html':'dist-cloudflare/index.html', 'headers':'dist-cloudflare/_headers',
                         'marker':'dist-cloudflare/_sbos-release.json', 'dotfile':'dist-github/.nojekyll',
                         'github':'dist-github/index.html'}
                path = out / paths[mutation]
                if mutation == 'remove': path.unlink()
                else: path.write_text('tampered')
                with self.assertRaises(ValueError): artifact.verify(out, self.sha, digest)

    def test_manifest_and_source_cannot_be_self_asserted(self):
        digest = self.seal()
        with self.assertRaises(ValueError): artifact.verify(self.output, 'b'*40, digest)
        (self.output / artifact.MANIFEST).write_text('{}')
        with self.assertRaises(ValueError): artifact.verify(self.output, self.sha, digest)

    def test_symlink_file_and_directory_are_rejected(self):
        for directory in (False, True):
            path = self.source / 'dist-cloudflare/link'
            path.symlink_to(self.source / 'dist-github' if directory else self.source / 'dist-github/index.html')
            with self.assertRaises(ValueError): self.seal()
            path.unlink()

    def test_wrong_marker_and_overwrite_are_rejected(self):
        self.seal()
        with self.assertRaises(ValueError): self.seal()
        with self.assertRaises(ValueError): artifact.seal(self.source, self.root/'other', 'b'*40)

    def test_comparison_rejects_changed_outputs(self):
        self.seal()
        (self.output / 'dist-github/index.html').write_text('changed')
        with self.assertRaises(ValueError): artifact.compare(self.source, self.output)
