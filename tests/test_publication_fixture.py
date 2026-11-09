from pathlib import Path
import tempfile
import unittest
from publication_fixture import PublicationFixture


class ReusablePublicationFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'source'
        self.source.mkdir()
        (self.source / 'mutable.json').write_text('{"original": true}')
        (self.source / 'immutable.txt').write_text('ORIGINAL')
        self.fixture = PublicationFixture(self.source, ['mutable.json'])
        self.addCleanup(self.fixture.close)

    def test_two_cases_share_one_copy_and_restore_inputs(self):
        with self.fixture.session() as first:
            (first / 'mutable.json').write_text('changed')
            (first / 'new').mkdir()
            (first / 'new/canary').write_text('NEVER_PUBLISH')
        with self.fixture.session() as second:
            self.assertEqual(first, second)
            self.assertEqual((second / 'mutable.json').read_bytes(), (self.source / 'mutable.json').read_bytes())
            self.assertFalse((second / 'new').exists())
        self.assertEqual(self.fixture.copies, 1)
        self.assertEqual((self.source / 'immutable.txt').read_text(), 'ORIGINAL')

    def test_exception_still_restores_the_next_case(self):
        with self.assertRaisesRegex(ValueError, 'fictional failure'):
            with self.fixture.session() as root:
                (root / 'mutable.json').write_text('changed')
                (root / 'canary').write_text('NEVER_PUBLISH')
                raise ValueError('fictional failure')
        with self.fixture.session() as root:
            self.assertFalse((root / 'canary').exists())
            self.assertEqual((root / 'mutable.json').read_bytes(), (self.source / 'mutable.json').read_bytes())

    def test_generated_roots_are_not_copied_but_nested_assets_are(self):
        for name in ['.git', '.release', 'dist', 'dist-cloudflare', 'dist-github']:
            (self.source / name).mkdir()
            (self.source / name / 'artifact').write_text('GENERATED')
        (self.source / 'assets/dist').mkdir(parents=True)
        (self.source / 'assets/dist/needed.js').write_text('PUBLIC')
        with self.fixture.session() as root:
            for name in ['.git', '.release', 'dist', 'dist-cloudflare', 'dist-github']:
                self.assertFalse((root / name).exists())
            self.assertEqual((root / 'assets/dist/needed.js').read_text(), 'PUBLIC')

    def test_undeclared_mutation_fails_and_cannot_be_reused(self):
        with self.assertRaisesRegex(AssertionError, 'undeclared'):
            with self.fixture.session() as root:
                (root / 'immutable.txt').write_text('CORRUPTED')
        with self.assertRaisesRegex(RuntimeError, 'integrity'):
            with self.fixture.session():
                pass
        self.assertEqual((self.source / 'immutable.txt').read_text(), 'ORIGINAL')

    def test_nested_use_and_active_cleanup_are_refused(self):
        with self.fixture.session():
            with self.assertRaisesRegex(RuntimeError, 'nested'):
                with self.fixture.session():
                    pass
            with self.assertRaisesRegex(RuntimeError, 'active'):
                self.fixture.close()

    def test_absolute_and_traversing_mutable_paths_are_refused(self):
        for path in ['/tmp/outside', '../outside']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                PublicationFixture(self.source, [path])

    def test_mutable_symlink_is_not_followed(self):
        outside = Path(self.temp.name) / 'outside'
        outside.write_text('OUTSIDE')
        (self.source / 'mutable.json').unlink()
        (self.source / 'mutable.json').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'unlinked'):
            with self.fixture.session():
                pass
        self.assertEqual(outside.read_text(), 'OUTSIDE')

    def test_other_symlinks_are_preserved_without_copying_targets(self):
        outside = Path(self.temp.name) / 'outside'
        outside.write_text('OUTSIDE')
        (self.source / 'link').symlink_to(outside)
        with self.fixture.session() as root:
            self.assertTrue((root / 'link').is_symlink())
        self.assertTrue(outside.exists())


if __name__ == '__main__':
    unittest.main()
