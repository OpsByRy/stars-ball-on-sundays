import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime,timezone,timedelta

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import build_hosts
import resolve_result_release
import verify_cloudflare_release


class PublicHosting(unittest.TestCase):
    def policy(self):return json.loads((ROOT/'hosting-policy.json').read_text())
    def fixture(self,folder):
        base=folder/'baseline';(base/'data/editions').mkdir(parents=True)
        (base/'data/editions/manifest.json').write_text('{"editions":[]}')
        (base/'data/editions/saved.json').write_text('{"immutable":"saved"}')
        (base/'assets').mkdir();(base/'assets/public.js').write_text('/* public presentation */')
        (base/'index.html').write_text('<link rel="canonical" href="https://opsbyry.github.io/stars-ball-on-sundays/"><a href="./assets/public.js">public</a>')
        (base/'players').mkdir();(base/'players/profile.html').write_text('<link rel="canonical" href="https://opsbyry.github.io/stars-ball-on-sundays/players/profile.html">')
        return base

    def test_site_mode_keeps_github_full_site_and_only_migrates_cloudflare_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);base=self.fixture(root);policy=self.policy();policy['githubMode']='site'
            result=build_hosts.assemble(base,root/'cf',root/'gh',policy,'a'*40)
            self.assertEqual((root/'gh/index.html').read_bytes(),(base/'index.html').read_bytes())
            self.assertIn('https://starsballonsundays.com/players/profile"',(root/'cf/players/profile.html').read_text())
            self.assertEqual((root/'cf/data/editions/saved.json').read_bytes(),(base/'data/editions/saved.json').read_bytes())
            self.assertEqual(result['unchangedNonHTMLFileCount'],3)
            receipt=json.loads((root/'cf/_sbos-release.json').read_text());self.assertEqual(receipt['sourceSHA'],'a'*40)
            self.assertFalse((root/'gh/migration-redirect.js').exists())

    def test_redirect_mode_preserves_resource_types_and_has_no_meta_refresh(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);base=self.fixture(root);policy=self.policy();policy['githubMode']='redirect'
            result=build_hosts.assemble(base,root/'cf',root/'gh',policy,'b'*40)
            self.assertIn('migration-redirect.js',(root/'gh/index.html').read_text())
            self.assertNotIn('http-equiv="refresh"',(root/'gh/index.html').read_text())
            self.assertEqual((root/'gh/data/editions/saved.json').read_bytes(),(base/'data/editions/saved.json').read_bytes())
            self.assertEqual(result['oldRoutes']['/stars-ball-on-sundays/players/profile.html'],'/players/profile')

    def test_destinations_modes_unknown_fields_and_private_artifact_paths_fail_closed(self):
        for key,value in [('canonicalOrigin','https://wrong.example'),('githubMode','anything'),('cloudflareAccountId','other'),('extra','no')]:
            policy=self.policy();policy[key]=value
            with self.assertRaises(ValueError):build_hosts.validate_policy(policy)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);base=self.fixture(root);(base/'assets/private.js.map').write_text('{}')
            with self.assertRaises(ValueError):build_hosts.assemble(base,root/'cf',root/'gh',self.policy(),'c'*40)

    def test_oversized_json_compaction_preserves_literal_tokens_and_source_bytes(self):
        raw=b' '*1024+b'{\n "number": 1.0000000000000000123, "exponent": 1e-007, "text": " spaced \\\" text ", "slash": "\\\\"\n}'
        expected=b'{"number":1.0000000000000000123,"exponent":1e-007,"text":" spaced \\\" text ","slash":"\\\\"}'
        self.assertEqual(build_hosts.pages_asset('data/editions/saved.json',raw,len(expected)),expected)
        self.assertEqual(json.loads(raw),json.loads(expected))
        self.assertEqual(build_hosts.pages_asset('data/editions/saved.json',raw,len(raw)),raw)
        for name,body,limit in [('assets/large.bin',raw,len(expected)),('data/saved.json',b'{"x":"long"}',2)]:
            with self.assertRaises(ValueError):build_hosts.pages_asset(name,body,limit)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);base=self.fixture(root);source=base/'data/editions/saved.json';source.write_bytes(raw)
            old_limit=build_hosts.PAGES_MAX_BYTES
            # Assembly uses a small test limit; the validated production limit remains 25 MiB.
            build_hosts.PAGES_MAX_BYTES=len(raw)-1
            old_asset=build_hosts.pages_asset
            build_hosts.pages_asset=lambda name,body:old_asset(name,body,len(raw)-1)
            try:result=build_hosts.assemble(base,root/'cf',root/'gh',self.policy(),'d'*40)
            finally:build_hosts.PAGES_MAX_BYTES=old_limit;build_hosts.pages_asset=old_asset
            self.assertEqual(source.read_bytes(),raw)
            for host in ['cf','gh']:self.assertEqual((root/host/'data/editions/saved.json').read_bytes(),expected)
            record=result['compactedJSON']['/data/editions/saved.json']
            self.assertEqual(record['sourceSHA256'],hashlib.sha256(raw).hexdigest())
            self.assertEqual(record['deployedSHA256'],hashlib.sha256(expected).hexdigest())

    def test_pending_price_publication_requires_verified_followup_before_later_results_bypass_expiry(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'data/editions').mkdir(parents=True)
            window={'schemaVersion':'sbos-publication-window-1','channel':'daily','date':'2026-10-31',
                'editionVersion':'a'*16,'quoteObservedAt':'2026-10-31T17:00:00Z','validUntil':'2026-10-31T17:15:00Z'}
            (root/'publication-window.json').write_text(json.dumps(window))
            index={'editions':[{'channel':'daily','date':'2026-10-31','version':'a'*16}]}
            (root/'data/editions/manifest.json').write_text(json.dumps(index))
            self.assertIn('within',build_hosts.publication_window(root,datetime(2026,10,31,17,10,tzinfo=timezone.utc)))
            for minute in [0,14,16]:
                moment=datetime(2026,10,31,16,59,tzinfo=timezone.utc) if minute==0 else datetime(2026,10,31,17,minute,tzinfo=timezone.utc)
                with self.assertRaisesRegex(ValueError,'expired'):build_hosts.publication_window(root,moment)
            index['editions'].append({'channel':'daily','date':'2026-10-31','version':'b'*16})
            (root/'data/editions/manifest.json').write_text(json.dumps(index))
            with self.assertRaisesRegex(ValueError,'expired'):build_hosts.publication_window(root,datetime(2026,11,1,tzinfo=timezone.utc))
            window['validUntil']='2026-11-01T17:15:00Z';(root/'publication-window.json').write_text(json.dumps(window))
            with self.assertRaisesRegex(ValueError,'freshness limit'):build_hosts.publication_window(root)
            (root/'publication-window.json').unlink()
            self.assertIn('no pending',build_hosts.publication_window(root,datetime(2026,11,1,tzinfo=timezone.utc)))

    def test_result_receipt_pins_the_actual_commit_and_rejects_other_runs_or_repositories(self):
        receipt={'schemaVersion':'sbos-result-release-1','repository':'OpsByRy/stars-ball-on-sundays','branch':'main','baseSHA':'a'*40,'sourceSHA':'b'*40}
        self.assertEqual(resolve_result_release.validate_receipt(receipt,'a'*40),'b'*40)
        for key,value in [('repository','other/repo'),('branch','untrusted'),('baseSHA','c'*40),('sourceSHA','bad')]:
            bad=copy.deepcopy(receipt);bad[key]=value
            with self.assertRaises(ValueError):resolve_result_release.validate_receipt(bad,'a'*40)

    def test_cloudflare_gate_rejects_stale_commit_or_changed_history(self):
        bodies={'/index.html':b'public','/data/editions/manifest.json':b'{"editions":[]}'}
        receipt={'schemaVersion':'sbos-public-release-1','sourceSHA':'a'*40,'canonicalOrigin':build_hosts.ORIGIN,
                 'files':{p:hashlib.sha256(b).hexdigest() for p,b in bodies.items()},
                 'editionManifestSHA256':hashlib.sha256(bodies['/data/editions/manifest.json']).hexdigest()}
        self.assertEqual(verify_cloudflare_release.verify(receipt,'a'*40,bodies.__getitem__),2)
        with self.assertRaises(ValueError):verify_cloudflare_release.verify(receipt,'b'*40,bodies.__getitem__)
        bodies['/data/editions/manifest.json']=b'changed history'
        with self.assertRaises(ValueError):verify_cloudflare_release.verify(receipt,'a'*40,bodies.__getitem__)

    def test_cloudflare_beacon_normalization_preserves_all_other_page_bytes(self):
        original=b'<html><body>verified public content</body></html>\n'
        beacon=(b'<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v'+b'a'*44+b'" integrity="sha512-'+b'A'*86+b'==" data-cf-beacon=\'{"version":"2024.11.0","token":"1ea6993beccf4beeb1b3927d67da293f","r":1,"spa":2}\' crossorigin="anonymous"></script>\n')
        injected=original.replace(b'</body>',beacon+b'</body>')
        self.assertEqual(verify_cloudflare_release.normalize_public_html(injected),original)
        for unsafe in [injected.replace(b'static.cloudflareinsights.com',b'other.example'),injected.replace(b'1ea6993beccf4beeb1b3927d67da293f',b'0'*32),injected.replace(b'</script>',b'</script><script>other()</script>'),beacon+original]:
            self.assertEqual(verify_cloudflare_release.normalize_public_html(unsafe),unsafe)
        altered=injected.replace(b'verified public content',b'changed content')
        self.assertNotEqual(verify_cloudflare_release.normalize_public_html(altered),original)

    def test_cloudflare_gate_checks_compacted_history_transport_hashes(self):
        bodies={'/index.html':b'public','/data/editions/manifest.json':b'{"editions":[]}',
                '/data/editions/saved.json':b'{"number":1.0000000000000000123}'}
        receipt={'schemaVersion':'sbos-public-release-1','sourceSHA':'e'*40,'canonicalOrigin':build_hosts.ORIGIN,
                 'files':{p:hashlib.sha256(b).hexdigest() for p,b in bodies.items()},
                 'editionManifestSHA256':hashlib.sha256(bodies['/data/editions/manifest.json']).hexdigest(),
                 'compactedJSON':{'/data/editions/saved.json':{'sourceSHA256':'f'*64,
                    'deployedSHA256':hashlib.sha256(bodies['/data/editions/saved.json']).hexdigest()}}}
        self.assertEqual(verify_cloudflare_release.verify(receipt,'e'*40,bodies.__getitem__),3)
        bodies['/data/editions/saved.json']=b'{"number":1.0}'
        with self.assertRaises(ValueError):verify_cloudflare_release.verify(receipt,'e'*40,bodies.__getitem__)


if __name__=='__main__':unittest.main()
