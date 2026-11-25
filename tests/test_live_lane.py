import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_live  # noqa: E402
import publish_live  # noqa: E402


def git(root, *args):
    subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)


class Repo:
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        git(self.root, 'init', '-q')
        git(self.root, 'config', 'user.email', 't@example.com')
        git(self.root, 'config', 'user.name', 't')

    def write(self, name, body):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body if isinstance(body, str) else json.dumps(body))

    def commit(self):
        git(self.root, 'add', '-A')
        git(self.root, 'commit', '-q', '-m', 'x')
        return subprocess.run(['git', '-C', str(self.root), 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()


class ChangedPaths(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.repo.write('data/editions/manifest.json', {'editions': []})
        self.repo.write('data/editions/daily/2026-11-23/' + 'a' * 16 + '.json', '{}')
        self.repo.write('assets/app.js', '1')
        self.base = self.repo.commit()

    def tearDown(self):
        self.repo.tmp.cleanup()

    def test_new_editions_and_index_updates_are_allowed(self):
        self.repo.write('data/editions/daily/2026-11-24/' + 'b' * 16 + '.json', '{}')
        self.repo.write('data/editions/manifest.json', {'editions': [1]})
        self.repo.write('pending-additions.json', '{}')
        head = self.repo.commit()
        added, modified = build_live.changed_paths(self.repo.root, self.base, head)
        self.assertEqual(modified, ['data/editions/manifest.json'])
        self.assertEqual(len(added), 2)

    def test_code_rewrites_and_deletions_are_declined(self):
        cases = [
            lambda r: r.write('assets/app.js', '2'),
            lambda r: r.write('data/editions/daily/2026-11-23/' + 'a' * 16 + '.json', '{"x":1}'),
            lambda r: (r.root / 'data/editions/daily/2026-11-23' / ('a' * 16 + '.json')).unlink(),
            lambda r: r.write('data/player-profiles/index.json', '{}'),
            lambda r: r.write('data/editions/daily/2026-11-24/notes.json', '{}'),
        ]
        for change in cases:
            with self.subTest(change=change):
                git(self.repo.root, 'reset', '-q', '--hard', self.base)
                git(self.repo.root, 'clean', '-qfd')
                change(self.repo)
                head = self.repo.commit()
                with self.assertRaises(build_live.Decline):
                    build_live.changed_paths(self.repo.root, self.base, head)


class RequireKept(unittest.TestCase):
    items = staticmethod(lambda body: body['editions'])

    def test_appended_and_interleaved_entries_are_new(self):
        old = {'editions': [{'a': 1}, {'a': 2}]}
        new = {'editions': [{'a': 1}, {'a': 3}, {'a': 2}, {'a': 4}]}
        self.assertEqual(build_live.require_kept('m', old, new, self.items), [{'a': 3}, {'a': 4}])

    def test_changed_removed_or_reordered_entries_are_declined(self):
        old = {'editions': [{'a': 1}, {'a': 2}]}
        for new in ({'editions': [{'a': 1}]}, {'editions': [{'a': 1}, {'a': 2, 'b': 1}]}, {'editions': [{'a': 2}, {'a': 1}]}):
            with self.subTest(new=new), self.assertRaises(build_live.Decline):
                build_live.require_kept('m', old, new, self.items)


class DeployedBytes(unittest.TestCase):
    def test_small_files_are_unchanged(self):
        self.assertEqual(build_live.deployed_bytes('data/a.json', b'{ "a": 1 }'), (b'{ "a": 1 }', b'{ "a": 1 }'))

    def test_oversized_json_is_compacted_like_the_pages_upload(self):
        original, limit = build_live.build_hosts.PAGES_MAX_BYTES, 64
        build_live.build_hosts.PAGES_MAX_BYTES = limit
        try:
            raw = json.dumps({'k': ['x' * 10] * 4}, indent=4).encode()
            deployed, served = build_live.deployed_bytes('data/editions/manifest.json', raw)
            self.assertEqual(deployed, build_live.build_hosts.json_tokens(raw))
            self.assertIs(served, deployed)
        finally:
            build_live.build_hosts.PAGES_MAX_BYTES = original


class Prove(unittest.TestCase):
    def test_reports_missing_and_different_files(self):
        base = {'files': {'/a': '1', '/b': '1', '/_sbos-release.json': 'x'}}
        head = {'files': {'/a': '2', '/b': '1', '/c': '3', '/_sbos-release.json': 'y'}}
        layer = {'files': {'/a': {'sha256': '2'}, '/c': {'sha256': '3'}}}
        self.assertTrue(build_live.prove(layer, {}, base, head)['identical'])
        layer = {'files': {'/a': {'sha256': '9'}}}
        proof = build_live.prove(layer, {}, base, head)
        self.assertEqual((proof['missingFromLayer'], proof['differentFromFullBuild'], proof['identical']), (['/c'], ['/a'], False))


class SiteTransforms(unittest.TestCase):
    def test_portraits_are_compared_after_the_sites_image_lockdown(self):
        built = {'schemaVersion': 'public-player-portraits-1', 'players': [
            {'id': 'nba:1', 'headshot': 'https://a.espncdn.com/i/headshots/nba/players/full/1.png', 'name': 'A'},
            {'id': 'nba:2', 'logo': 'https://cdn.nba.com/logos/nba/1/primary/L/logo.svg', 'keep': 'https://example.com/x.png'}]}
        served = {'schemaVersion': 'public-player-portraits-1', 'players': [{'id': 'nba:1', 'name': 'A'},
                                                                            {'id': 'nba:2', 'keep': 'https://example.com/x.png'}]}
        with tempfile.TemporaryDirectory() as tmp:
            raw = json.dumps(built).encode()
            entry = {'sha256': build_live.hashlib.sha256(raw).hexdigest()}
            (Path(tmp) / 'blobs').mkdir()
            (Path(tmp) / 'blobs' / entry['sha256']).write_bytes(raw)
            path = '/data/player-portraits.json'
            self.assertTrue(publish_live.served_as_built(path, entry, json.dumps(served).encode(), tmp))
            self.assertFalse(publish_live.served_as_built(path, entry, raw, tmp))
            served['players'][0]['name'] = 'B'
            self.assertFalse(publish_live.served_as_built(path, entry, json.dumps(served).encode(), tmp))

    def test_other_files_must_be_byte_identical(self):
        entry = {'sha256': build_live.hashlib.sha256(b'{"a":1}').hexdigest()}
        self.assertTrue(publish_live.served_as_built('/data/x.json', entry, b'{"a":1}', '/nonexistent'))
        self.assertFalse(publish_live.served_as_built('/data/x.json', entry, b'{"a": 1}', '/nonexistent'))


class FavoriteOverlay(unittest.TestCase):
    def check(self, path, built, served, envelope=False):
        with tempfile.TemporaryDirectory() as tmp:
            raw = json.dumps(built, indent=2).encode()
            data = publish_live.json_transport.encode(raw) if envelope else raw
            entry = {'sha256': build_live.hashlib.sha256(data).hexdigest()}
            if envelope:
                entry['servedSHA256'] = build_live.hashlib.sha256(raw).hexdigest()
            (Path(tmp) / 'blobs').mkdir()
            (Path(tmp) / 'blobs' / entry['sha256']).write_bytes(data)
            return publish_live.served_as_built(path, entry, json.dumps(served, separators=(',', ':')).encode(), tmp)

    def test_editions_and_boards_with_ry_favorites_marked_by_the_site(self):
        edition = {'date': '2026-11-25', 'props': [{'id': 'a', 'line': 3}, {'id': 'b', 'line': 4}]}
        marked = {'date': '2026-11-25', 'props': [{'id': 'a', 'line': 3, 'ryFavorite': True}, {'id': 'b', 'line': 4}]}
        for envelope in (False, True):
            self.assertTrue(self.check('/data/editions/daily/2026-11-25/' + 'a' * 16 + '.json', edition, marked, envelope))
            self.assertTrue(self.check('/data/boards/daily/2026-11-25/' + 'a' * 16 + '.json', {'edition': edition}, {'edition': marked}, envelope))
        changed = {'date': '2026-11-25', 'props': [{'id': 'a', 'line': 9, 'ryFavorite': True}, {'id': 'b', 'line': 4}]}
        self.assertFalse(self.check('/data/editions/daily/2026-11-25/' + 'a' * 16 + '.json', edition, changed))
        # Only those paths: anything else must still be byte-identical.
        self.assertFalse(self.check('/data/published-picks/daily/2026-11-25.json', edition, marked))


if __name__ == '__main__':
    unittest.main()
