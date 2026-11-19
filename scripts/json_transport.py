"""Lossless wire representation for immutable editions too large for Pages."""
import base64
import gzip
import hashlib
import json
import re
import zlib

SCHEMA = 'sbos-json-gzip-1'
PREFIX = ('{"schemaVersion":"' + SCHEMA + '",').encode()
MAX_WIRE_BYTES = 8 * 1024 * 1024
MAX_SOURCE_BYTES = 512 * 1024 * 1024
FIELDS = {'schemaVersion', 'encoding', 'sourceBytes', 'sourceSHA256', 'compressedBytes', 'compressedSHA256', 'payload'}


def encode(raw):
    json.loads(raw)
    if not 0 < len(raw) <= MAX_SOURCE_BYTES:
        raise ValueError('JSON source exceeds transport bound')
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    body = {'schemaVersion': SCHEMA, 'encoding': 'gzip', 'sourceBytes': len(raw),
            'sourceSHA256': hashlib.sha256(raw).hexdigest(), 'compressedBytes': len(compressed),
            'compressedSHA256': hashlib.sha256(compressed).hexdigest(),
            'payload': base64.b64encode(compressed).decode('ascii')}
    wire = (json.dumps(body, separators=(',', ':')) + '\n').encode()
    if len(wire) > MAX_WIRE_BYTES:
        raise ValueError('Encoded JSON exceeds transport bound')
    if decode(wire) != raw:
        raise ValueError('JSON transport reconstruction differs from source')
    return wire


def decode(wire):
    if not wire.startswith(PREFIX) or len(wire) > MAX_WIRE_BYTES:
        raise ValueError('Invalid JSON transport representation')
    body = json.loads(wire)
    if set(body) != FIELDS or body['schemaVersion'] != SCHEMA or body['encoding'] != 'gzip':
        raise ValueError('Invalid JSON transport schema')
    for key, limit in [('sourceBytes', MAX_SOURCE_BYTES), ('compressedBytes', MAX_WIRE_BYTES)]:
        if type(body[key]) is not int or not 0 < body[key] <= limit:
            raise ValueError('Invalid JSON transport size')
    for key in ['sourceSHA256', 'compressedSHA256']:
        if not isinstance(body[key], str) or not re.fullmatch('[0-9a-f]{64}', body[key]):
            raise ValueError('Invalid JSON transport digest')
    payload = body['payload']
    if not isinstance(payload, str) or len(payload) != 4 * ((body['compressedBytes'] + 2) // 3):
        raise ValueError('Invalid JSON transport payload')
    compressed = base64.b64decode(payload, validate=True)
    if (len(compressed) != body['compressedBytes'] or base64.b64encode(compressed).decode('ascii') != payload
            or hashlib.sha256(compressed).hexdigest() != body['compressedSHA256']):
        raise ValueError('Compressed JSON digest differs')
    decoder = zlib.decompressobj(31)
    raw = decoder.decompress(compressed, body['sourceBytes'] + 1)
    if (len(raw) != body['sourceBytes'] or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail
            or hashlib.sha256(raw).hexdigest() != body['sourceSHA256']):
        raise ValueError('Reconstructed JSON differs')
    return raw
