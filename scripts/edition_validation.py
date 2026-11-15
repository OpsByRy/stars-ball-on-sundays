"""Reuse validation of identical edition bytes within one Python process.

Every access still checks the path and reads/hashes the entire file. Only successful
schema/digest checks are reused, and only for the same validator and canonicalizer.
The cache never crosses a process or CI trust boundary and retains small summaries,
not the full archive bodies. Manifest and cross-edition checks remain with the caller.
"""
from collections import OrderedDict
from dataclasses import dataclass
import hashlib
import json

MAX_ENTRIES = 4096
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

    def personal_body(self):
        # Give each caller its own mutable copy of the small personal-record view.
        return json.loads(self.personal_json)


def read_edition(root, name, *, safe_file, validate, canonical):
    raw = safe_file(root, name).read_bytes()
    key = (validate, canonical, hashlib.sha256(raw).digest())
    if key in _checked:
        _checked.move_to_end(key)
        return _checked[key]
    body = json.loads(raw)
    validate(body)
    if hashlib.sha256(canonical({k: v for k, v in body.items() if k != 'version'})).hexdigest()[:16] != body['version']:
        raise ValueError('Edition digest mismatch')
    personal = {k: v for k, v in body.items() if k != 'props'}
    personal['props'] = [p for p in body['props'] if p['group'] == 'ry']
    checked = CheckedEdition(
        body['channel'], body['date'], body['version'], len(personal['props']),
        sum(p['group'] == 'research' for p in body['props']),
        frozenset((p['date'], p.get('canonicalEventId') or p.get('eventId'), p.get('playerId'))
                  for p in body['props']), canonical(personal))
    _checked[key] = checked
    if len(_checked) > MAX_ENTRIES:
        _checked.popitem(last=False)
    return checked


def clear_cache():
    _checked.clear()
