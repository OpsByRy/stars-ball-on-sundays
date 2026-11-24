"""Reuse validation of identical edition bytes within one Python process.

Every access still checks the path and reads/hashes the entire file. Only successful
schema/digest checks are reused, and only for the same validator and canonicalizer.
The cache never crosses a CI job or trust boundary and retains small summaries,
not the full archive bodies. `prevalidate` may fill it from short-lived worker
processes that the same build starts, from the same checkout and code, running
the same read_edition check. It is never saved or restored. Manifest and
cross-edition checks remain with the caller.
"""
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass
import hashlib
import json
import multiprocessing
import os
import pickle
import sys

MAX_ENTRIES = 4096
MIN_PARALLEL = 8
_checked = OrderedDict()


@dataclass(frozen=True)
class CheckedEdition:
    channel: str
    date: str
    version: str
    count: int
    research_count: int
    targets: frozenset
    personal_json: bytes
    byte_sha256: str

    def personal_body(self):
        # Give each caller its own mutable copy of the small personal-record view.
        return json.loads(self.personal_json)


def read_edition(root, name, *, safe_file, validate, canonical):
    return _check_bytes(safe_file(root, name).read_bytes(), validate, canonical)


def _check_bytes(raw, validate, canonical):
    key = (validate, canonical, hashlib.sha256(raw).digest())
    if key in _checked:
        _checked.move_to_end(key)
        return _checked[key]
    # Match the original UTF-8 text reader; bytes-mode JSON also admits UTF-16/32.
    body = json.loads(raw.decode('utf-8'))
    validate(body)
    if hashlib.sha256(canonical({k: v for k, v in body.items() if k != 'version'})).hexdigest()[:16] != body['version']:
        raise ValueError('Edition digest mismatch')
    personal = {k: v for k, v in body.items() if k != 'props'}
    personal['props'] = [p for p in body['props'] if p['group'] == 'ry']
    checked = CheckedEdition(
        body['channel'], body['date'], body['version'], len(personal['props']),
        sum(p['group'] == 'research' for p in body['props']),
        frozenset((p['date'], p.get('canonicalEventId') or p.get('eventId'), p.get('playerId'))
                  for p in body['props']), canonical(personal), key[2].hex())
    _checked[key] = checked
    if len(_checked) > MAX_ENTRIES:
        _checked.popitem(last=False)
    return checked


def clear_cache():
    _checked.clear()


_known_in_worker = frozenset()


def _init_worker(known):
    global _known_in_worker
    _known_in_worker = known


def _worker_read(task):
    root, name, safe_file, validate, canonical = task
    try:
        raw = safe_file(root, name).read_bytes()
        if hashlib.sha256(raw).digest() in _known_in_worker:
            return None  # The caller already validated these exact bytes.
        return _check_bytes(raw, validate, canonical)
    except Exception:
        # Never cache a failure: the caller's own read raises it, in manifest order.
        return None


def worker_count():
    value = os.environ.get('SBOS_VALIDATION_WORKERS')
    if value is not None:
        if not value.isdigit() or int(value) < 1:
            raise ValueError('SBOS_VALIDATION_WORKERS must be a positive integer')
        return int(value)
    return min(4, os.cpu_count() or 1)


def prevalidate(root, names, *, safe_file, validate, canonical, workers=None):
    """Run the full read_edition check for many editions in parallel processes.

    This only warms this process's cache; it changes no rule. Each worker reads,
    hashes, schema-validates and digest-checks the complete file exactly as
    read_edition does, and its result is keyed by the SHA-256 of the bytes it checked.
    The caller still calls read_edition for every edition, which re-reads and re-hashes
    the file, so a worker result is reused only for byte-identical content. Failures are
    not cached. Editions whose exact bytes this process already validated are only
    hashed, not checked again. Returns the number of editions validated by workers.

    Workers are spawned, so a script that calls the build must keep its work under
    `if __name__ == '__main__':` (build.py and build_hosts.py do). If workers cannot
    start, validation continues serially. SBOS_VALIDATION_WORKERS=1 turns this off.
    """
    names = list(dict.fromkeys(names))
    if workers is None:
        # Starting processes costs more than a few small editions take to check.
        if len(names) < MIN_PARALLEL:
            return 0
        workers = worker_count()
    workers = min(workers, len(names))
    if workers < 2:
        return 0
    try:
        # Mocks and lambdas cannot cross a process boundary; fall back to serial reads.
        pickle.dumps((safe_file, validate, canonical))
    except Exception:
        return 0
    tasks = [(root, name, safe_file, validate, canonical) for name in names]
    # Digests this process already validated with the same checks; workers only hash those.
    known = frozenset(key[2] for key in _checked if key[0] is validate and key[1] is canonical)
    warmed = 0
    try:
        with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context('spawn'),
                                 initializer=_init_worker, initargs=(known,)) as pool:
            for checked in pool.map(_worker_read, tasks):
                if checked is None:
                    continue
                key = (validate, canonical, bytes.fromhex(checked.byte_sha256))
                _checked[key] = checked
                _checked.move_to_end(key)
                warmed += 1
    except (BrokenProcessPool, OSError) as error:
        # Workers could not run here; the caller's serial reads check everything anyway.
        print(f'Parallel edition validation unavailable ({error}); continuing serially.', file=sys.stderr)
    while len(_checked) > MAX_ENTRIES:
        _checked.popitem(last=False)
    return warmed
