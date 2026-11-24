"""Changed bytes and publication relationships must never trust a warm cache."""
import copy
from dataclasses import FrozenInstanceError
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import build
import edition_validation as cache
import public_schema


class EditionValidationCache(unittest.TestCase):
    def setUp(self):
        cache.clear_cache()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(cache.clear_cache)
        self.root = Path(self.temp.name)
        self.validate = Mock(wraps=public_schema.validate_edition)
        self.safe = Mock(wraps=build.safe_file)
        self.body = {'schemaVersion': 'public-1', 'channel': 'daily', 'date': '2026-11-22',
                     'timezone': 'America/New_York', 'props': [
                         {'id': 'research-1', 'date': '2026-11-22', 'player': 'Example Player',
                          'playerId': 'nba:1', 'eventId': 'nba:1', 'market': 'PTS',
                          'operator': '>=', 'line': 10, 'group': 'research'}]}
        self.write(self.body)

    def write(self, body, name='edition.json'):
        body['version'] = hashlib.sha256(build.canonical({k: v for k, v in body.items() if k != 'version'})).hexdigest()[:16]
        (self.root / name).write_bytes(build.canonical(body))

    def read(self, name='edition.json', **kwargs):
        return cache.read_edition(self.root, name, safe_file=self.safe,
                                  validate=kwargs.get('validate', self.validate),
                                  canonical=kwargs.get('canonical', build.canonical))

    def test_identical_bytes_reuse_validation_but_check_each_path(self):
        (self.root / 'copy.json').write_bytes((self.root / 'edition.json').read_bytes())
        first = self.read(); second = self.read('copy.json')
        self.assertIs(first, second)
        self.assertEqual(self.validate.call_count, 1)
        self.assertEqual(self.safe.call_count, 2)
        self.assertEqual(first.research_count, 1)
        self.assertEqual(first.targets, frozenset({('2026-11-22', 'nba:1', 'nba:1')}))

    def test_same_size_same_mtime_tampering_still_revalidates_and_fails_digest(self):
        self.read(); p = self.root / 'edition.json'; stat = p.stat()
        raw = p.read_bytes(); altered = raw.replace(b'"line":10', b'"line":11')
        self.assertNotEqual(raw, altered); self.assertEqual(len(raw), len(altered))
        p.write_bytes(altered); os.utime(p, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.read()
        self.assertEqual(self.validate.call_count, 2)

    def test_schema_failures_are_never_cached(self):
        self.body['private_feature'] = 'NEVER_PUBLISH'; self.write(self.body)
        for _ in range(2):
            with self.assertRaisesRegex(ValueError, 'unknown'):
                self.read()
        self.assertEqual(self.validate.call_count, 2)

    def test_non_utf8_and_bom_inputs_keep_the_original_text_reader_rejection(self):
        self.read()
        p = self.root / 'edition.json'; original = p.read_bytes()
        for raw in [b'\xef\xbb\xbf' + original, original.decode('utf-8').encode('utf-16'),
                    original.decode('utf-8').encode('utf-32')]:
            with self.subTest(prefix=raw[:4]):
                p.write_bytes(raw)
                with self.assertRaises((ValueError, UnicodeError)):
                    json.loads(raw.decode('utf-8'))
                with self.assertRaises((ValueError, UnicodeError)):
                    self.read()
        self.assertEqual(self.validate.call_count, 1)

    def test_validator_and_canonicalizer_changes_cannot_reuse_prior_checks(self):
        self.read()
        other = Mock(wraps=public_schema.validate_edition)
        self.read(validate=other)
        self.assertEqual(other.call_count, 1)
        self.read(canonical=lambda body: build.canonical(body))
        self.assertEqual(self.validate.call_count, 2)

    def test_byte_changes_revalidate_even_with_the_same_canonical_digest(self):
        first = self.read()
        p = self.root / 'edition.json'; p.write_bytes(b' ' + p.read_bytes())
        second = self.read()
        self.assertIsNot(first, second)
        self.assertEqual(first.version, second.version)
        self.assertEqual(self.validate.call_count, 2)

    def test_warm_entry_cannot_bypass_symlink_guard(self):
        self.read(); p = self.root / 'edition.json'
        target = self.root / 'copy.json'; target.write_bytes(p.read_bytes())
        p.unlink(); p.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.read()
        self.assertEqual(self.validate.call_count, 1)

    def test_cached_summary_has_no_shared_mutable_personal_state_or_raw_body(self):
        summary = self.read(); body = summary.personal_body()
        body['channel'] = 'sunday'; body['props'].append({'private': True})
        self.assertEqual(self.read().personal_body()['channel'], 'daily')
        self.assertEqual(self.read().personal_body()['props'], [])
        with self.assertRaises(FrozenInstanceError):
            summary.channel = 'sunday'
        self.assertLess(len(summary.personal_json), len((self.root / 'edition.json').read_bytes()))

    def test_cache_is_bounded_and_eviction_revalidates(self):
        original = (self.root / 'edition.json').read_bytes()
        with patch.object(cache, 'MAX_ENTRIES', 2):
            for line in [10, 11, 12]:
                self.body['props'][0]['line'] = line; self.write(self.body); self.read()
            self.assertEqual(len(cache._checked), 2)
            (self.root / 'edition.json').write_bytes(original); self.read()
        self.assertEqual(self.validate.call_count, 4)


class CachedPublicationRelationships(unittest.TestCase):
    def setUp(self):
        cache.clear_cache()
        self.addCleanup(cache.clear_cache)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'data/editions').mkdir(parents=True)
        self.source = json.loads((ROOT / 'data/editions/sunday/2026-11-01/3b91e2be313d30e2.json').read_bytes())
        self.entries = []
        self.add(self.source)
        self.targets = {'schemaVersion': 'public-1', 'targets': []}
        (self.root / 'data/stat-targets.json').write_bytes(build.canonical(self.targets))

    def add(self, body):
        body = copy.deepcopy(body)
        body['version'] = hashlib.sha256(build.canonical({k: v for k, v in body.items() if k != 'version'})).hexdigest()[:16]
        entry = {'channel': body['channel'], 'date': body['date'], 'version': body['version'],
                 'path': f"{body['channel']}/{body['date']}/{body['version']}.json",
                 'count': sum(r['group'] == 'ry' for r in body['props']),
                 'researchCount': sum(r['group'] == 'research' for r in body['props']),
                 'updatedAt': body['updatedAt']}
        p = self.root / 'data/editions' / entry['path']; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(build.canonical(body)); self.entries.append(entry); self.manifest()

    def manifest(self):
        (self.root / 'data/editions/manifest.json').write_bytes(build.canonical({'schemaVersion': 'public-1', 'editions': self.entries}))

    def test_manifest_counts_are_rechecked_with_warm_edition_bytes(self):
        build.publication_files(self.root)
        self.entries[0]['count'] += 1; self.manifest()
        with self.assertRaisesRegex(ValueError, 'count mismatch'):
            build.publication_files(self.root)

    def test_cached_body_cannot_be_reused_under_another_manifest_date(self):
        build.publication_files(self.root)
        entry = copy.deepcopy(self.entries[0]); entry['date'] = '2026-11-08'
        entry['path'] = f"sunday/2026-11-08/{entry['version']}.json"
        p = self.root / 'data/editions' / entry['path']; p.parent.mkdir(parents=True)
        p.write_bytes((self.root / 'data/editions' / self.entries[0]['path']).read_bytes())
        self.entries.append(entry); self.manifest()
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            build.publication_files(self.root)

    def test_changed_result_targets_still_require_a_published_identity(self):
        build.publication_files(self.root)
        self.targets['targets'].append({'date': '2026-11-01', 'eventId': 'nba:999', 'playerId': 'nba:999',
                                        'espnEventId': '999', 'espnAthleteId': '999'})
        (self.root / 'data/stat-targets.json').write_bytes(build.canonical(self.targets))
        with self.assertRaisesRegex(ValueError, 'Unpublished candidate'):
            build.publication_files(self.root)

    def test_cross_edition_personal_clock_preservation_runs_after_cache_hits(self):
        later = copy.deepcopy(self.source)
        later['updatedAt'] = '2026-11-02T00:00:00Z'
        later['personalPublication']['recordedAt'] = '2026-11-01T18:21:00Z'
        public_schema.validate_edition(later)
        self.add(later)
        # Warm the individual entries without treating their relationship as valid.
        for e in self.entries:
            cache.read_edition(self.root, 'data/editions/' + e['path'], safe_file=build.safe_file,
                               validate=build.validate_edition, canonical=build.canonical)
        with self.assertRaisesRegex(ValueError, 'Verified personal publication clock'):
            build.publication_files(self.root)

    def test_personal_quote_view_matches_the_original_source_and_is_independent_of_callers(self):
        build.publication_files(self.root)
        view = build.personal_price_view(self.root)
        tickets = view['data/personal-tracking-prices.json']['tickets']
        self.assertEqual(len(tickets), len(self.source['personalSlips']))
        self.assertEqual(tickets[0]['americanOdds'], self.source['personalSlips'][0]['americanOdds'])
        tickets[0]['americanOdds'] = 99999
        self.assertNotEqual(build.personal_price_view(self.root)['data/personal-tracking-prices.json']['tickets'][0]['americanOdds'], 99999)


if __name__ == '__main__':
    unittest.main()


class ParallelPrevalidation(unittest.TestCase):
    """Worker processes run the same full check; the serial read still decides."""

    def setUp(self):
        cache.clear_cache()
        self.addCleanup(cache.clear_cache)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.names = []
        for line in (10, 11, 12):
            body = {'schemaVersion': 'public-1', 'channel': 'daily', 'date': '2026-11-22',
                    'timezone': 'America/New_York', 'props': [
                        {'id': f'research-{line}', 'date': '2026-11-22', 'player': 'Example Player',
                         'playerId': 'nba:1', 'eventId': 'nba:1', 'market': 'PTS',
                         'operator': '>=', 'line': line, 'group': 'research'}]}
            body['version'] = hashlib.sha256(build.canonical(body)).hexdigest()[:16]
            name = f'edition-{line}.json'
            (self.root / name).write_bytes(build.canonical(body))
            self.names.append(name)

    def prevalidate(self, **kwargs):
        return cache.prevalidate(self.root, self.names, safe_file=build.safe_file,
                                 validate=public_schema.validate_edition, canonical=build.canonical,
                                 workers=kwargs.get('workers', 2))

    def read(self, name):
        return cache.read_edition(self.root, name, safe_file=build.safe_file,
                                  validate=public_schema.validate_edition, canonical=build.canonical)

    def test_parallel_results_equal_serial_results_and_are_reused(self):
        self.assertEqual(self.prevalidate(), 3)
        self.assertEqual(len(cache._checked), 3)
        with patch.object(cache.json, 'loads', side_effect=AssertionError('reparsed')):
            parallel = [self.read(name) for name in self.names]
        cache.clear_cache()
        self.assertEqual(parallel, [self.read(name) for name in self.names])

    def test_worker_failures_are_not_cached_and_the_serial_read_raises(self):
        p = self.root / self.names[1]
        p.write_bytes(p.read_bytes().replace(b'"line":11', b'"line":13'))
        self.assertEqual(self.prevalidate(), 2)
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.read(self.names[1])

    def test_bytes_changed_after_prevalidation_are_checked_again(self):
        self.prevalidate()
        p = self.root / self.names[0]; stat = p.stat()
        p.write_bytes(p.read_bytes().replace(b'"line":10', b'"line":19'))
        os.utime(p, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.read(self.names[0])

    def test_unpicklable_checks_and_small_archives_stay_serial(self):
        self.assertEqual(cache.prevalidate(self.root, self.names, safe_file=build.safe_file,
                                           validate=Mock(wraps=public_schema.validate_edition),
                                           canonical=build.canonical, workers=2), 0)
        self.assertEqual(self.prevalidate(workers=None), 0)  # below MIN_PARALLEL
        self.assertEqual(self.prevalidate(workers=1), 0)
        self.assertEqual(len(cache._checked), 0)

    def test_worker_setting_must_be_a_positive_integer(self):
        for value in ('0', '-1', 'four', ''):
            with self.subTest(value=value), patch.dict(os.environ, {'SBOS_VALIDATION_WORKERS': value}):
                with self.assertRaises(ValueError):
                    cache.worker_count()
        with patch.dict(os.environ, {'SBOS_VALIDATION_WORKERS': '3'}):
            self.assertEqual(cache.worker_count(), 3)

    def test_already_validated_bytes_are_only_hashed_by_workers(self):
        self.read(self.names[0])
        self.assertEqual(self.prevalidate(), 2)
        p = self.root / self.names[0]
        p.write_bytes(p.read_bytes().replace(b'"line":10', b'"line":18'))
        # The other two are now known (only hashed); the changed bytes are not, fail, and are not cached.
        self.assertEqual(self.prevalidate(), 0)
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.read(self.names[0])
