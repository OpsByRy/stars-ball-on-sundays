"""Run one deterministic shard of the Python test suite.

`Publish SBOS` runs the shards as parallel jobs next to the site build, so the
full suite still gates every deployment without adding its time to the build.
Every `tests/test_*.py` module belongs to exactly one shard; `--check` proves the
shards cover the same modules `unittest discover -s tests` would find.
"""
import argparse
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / 'tests'

# Relative cost, measured locally on Nov 23 (test_publication ~750 s alone). These modules
# validate or copy the full real archive; placing them first keeps the shards balanced. A
# module missing from this table is still run (weight 1); only the balance is affected.
WEIGHTS = {
    'test_publication': 13,
    'test_personal_snapshot': 8,
    'test_personal_slips': 8,
    'test_sgp_research': 2,
}


def modules():
    return sorted(path.stem for path in TESTS.glob('test_*.py'))


def shards(count, names=None):
    names = modules() if names is None else sorted(names)
    if count < 1:
        raise ValueError('Shard count must be at least 1')
    groups = [[] for _ in range(count)]
    load = [0] * count
    # Longest first, ties by name, each to the lightest shard (lowest index on ties).
    for name in sorted(names, key=lambda n: (-WEIGHTS.get(n, 1), n)):
        index = min(range(count), key=lambda i: (load[i], i))
        groups[index].append(name)
        load[index] += WEIGHTS.get(name, 1)
    return [sorted(group) for group in groups]


def check(count):
    discovered = set()
    stack = [unittest.defaultTestLoader.discover(str(TESTS), top_level_dir=str(TESTS))]
    while stack:
        suite = stack.pop()
        for item in suite:
            if isinstance(item, unittest.TestSuite):
                stack.append(item)
            elif type(item).__module__ == 'unittest.loader':
                raise SystemExit('A test module failed to import: ' + item.id())
            else:
                discovered.add(type(item).__module__)
    assigned = [name for group in shards(count) for name in group]
    if len(assigned) != len(set(assigned)):
        raise SystemExit('A test module is assigned to more than one shard')
    if set(assigned) != discovered:
        missing = sorted(discovered - set(assigned))
        extra = sorted(set(assigned) - discovered)
        raise SystemExit(f'Shards differ from discovery; missing={missing} extra={extra}')
    return len(assigned)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--of', type=int, required=True, help='Total number of shards')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--shard', type=int, help='Shard to run, 1-based')
    group.add_argument('--check', action='store_true', help='Verify every discovered module is in exactly one shard')
    args = parser.parse_args()
    if args.check:
        print(f'{check(args.of)} test modules, each in exactly one of {args.of} shards.')
        return
    if not 1 <= args.shard <= args.of:
        raise SystemExit('Shard must be between 1 and --of')
    names = shards(args.of)[args.shard - 1]
    print(f'Shard {args.shard}/{args.of}: ' + ', '.join(names), flush=True)
    # Same import layout as `python -m unittest discover -s tests`.
    sys.path.insert(0, str(TESTS))
    suite = unittest.defaultTestLoader.loadTestsFromNames(names)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful() or result.testsRun == 0 and names:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
