import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

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


if __name__=='__main__':unittest.main()
