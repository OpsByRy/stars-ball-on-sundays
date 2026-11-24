"""The parallel Python test jobs must still run every test module exactly once."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import shard_tests


class TestShards(unittest.TestCase):
    def test_shards_partition_every_module(self):
        names = shard_tests.modules()
        self.assertIn('test_publication', names)
        for count in range(1, 7):
            with self.subTest(count=count):
                groups = shard_tests.shards(count)
                self.assertEqual(len(groups), count)
                flat = [name for group in groups for name in group]
                self.assertEqual(sorted(flat), names)
                self.assertEqual(len(flat), len(set(flat)))

    def test_assignment_is_deterministic(self):
        self.assertEqual(shard_tests.shards(4), shard_tests.shards(4))
        self.assertEqual(shard_tests.shards(2, ['test_b', 'test_a', 'test_publication']),
                         [['test_publication'], ['test_a', 'test_b']])

    def test_invalid_shard_count_is_refused(self):
        with self.assertRaises(ValueError):
            shard_tests.shards(0)


if __name__ == '__main__':
    unittest.main()
