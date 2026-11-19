import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import json_transport
import build_hosts
import build
import verify_cloudflare_release
import release_artifact

class JSONTransport(unittest.TestCase):
    def test_exact_tokens_and_source_bytes_survive_roundtrip_and_corruption_fails(self):
        raw=b'{"precision":1.0000000000000000123,"exponent":1e-007,"clock":"2026-11-18T17:00:30Z","price":-215,"text":" spaces \\\" \\u0107 "}\n'
        wire=json_transport.encode(raw)
        self.assertEqual(json_transport.decode(wire),raw)
        for changes in [{'sourceSHA256':'0'*64},{'compressedSHA256':'0'*64},{'sourceBytes':len(raw)-1},{'sourceBytes':len(raw)+1},{'payload':'bad'},{'extra':True}]:
            body=json.loads(wire);body.update(changes)
            with self.assertRaises((ValueError,TypeError)):
                json_transport.decode(json.dumps(body,separators=(',',':')).encode())

    def test_oversized_immutable_edition_is_exact_on_both_hosts_and_seal_remains_strict(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);base=root/'baseline';path='data/editions/daily/2026-11-18/'+'a'*16+'.json'
            source=base/path;source.parent.mkdir(parents=True)
            raw=b'{"value":"'+b'x'*(build_hosts.PAGES_MAX_BYTES+1)+b'","quote":-215,"capturedAt":"2026-11-18T17:00:30Z"}\n'
            source.write_bytes(raw);(base/'index.html').write_text('<html><body>verified</body></html>')
            (base/'data/editions/manifest.json').write_text('{"editions":[]}')
            (base/'assets').mkdir();(base/'assets/json-transport.js').write_bytes((ROOT/'assets/json-transport.js').read_bytes())
            policy=json.loads((ROOT/'hosting-policy.json').read_text())
            result=build_hosts.assemble(base,root/'dist-cloudflare',root/'dist-github',policy,'a'*40)
            wire=(root/'dist-cloudflare'/path).read_bytes()
            self.assertLessEqual(len(wire),25*1024*1024)
            self.assertEqual(wire,(root/'dist-github'/path).read_bytes())
            self.assertEqual(json_transport.decode(wire),raw)
            self.assertEqual(source.read_bytes(),raw)
            self.assertEqual(result['encodedJSON']['/'+path]['sourceSHA256'],hashlib.sha256(raw).hexdigest())
            receipt=json.loads((root/'dist-cloudflare/_sbos-release.json').read_bytes())
            fetch=lambda p:(root/'dist-cloudflare'/p.lstrip('/')).read_bytes()
            self.assertEqual(verify_cloudflare_release.verify(receipt,'a'*40,fetch),3)
            sealed=release_artifact.seal(root,root/'sealed','a'*40)
            self.assertTrue(release_artifact.verify(root/'sealed','a'*40,sealed['manifestSHA256']))
            (root/'sealed/dist-cloudflare'/path).write_bytes(wire+b' ')
            with self.assertRaises(ValueError):release_artifact.verify(root/'sealed','a'*40,sealed['manifestSHA256'])

    def test_reader_precedes_publication_and_is_idempotent(self):
        page='<script defer src="../assets/publication.js?v=old"></script>'
        linked=build.transport_script(page)
        self.assertLess(linked.index('json-transport.js'),linked.index('publication.js'))
        self.assertEqual(build.transport_script(linked),linked)

if __name__=='__main__':unittest.main()
