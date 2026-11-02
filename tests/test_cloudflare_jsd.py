import base64, copy, hashlib, json, sys, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from verify_cloudflare_release import ORIGIN, normalize_public_html, verify

JSD=(ROOT/'tests/fixtures/cloudflare-jsd-envelope.html').read_bytes().removesuffix(b'\n')
BEACON=(b'<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v'+b'a'*44+b'" integrity="sha512-'+b'A'*86+b'==" data-cf-beacon=\'{"version":"2024.11.0","token":"1ea6993beccf4beeb1b3927d67da293f","r":1,"spa":2}\' crossorigin="anonymous"></script>\n')
ORIGINAL=b'<html><body>\n<main>Published UTF-8: \xe2\x98\x85; quote time unknown.</main>\n<script data-app>applicationCode()</script></body></html>\n'
HISTORY=b'{"editions":[{"quoteObservedAt":null}]}\n'
SOURCE='a'*40

def page(envelope):return ORIGINAL.replace(b'</body>',envelope+b'</body>')
def receipt():
 bodies={'/about/index.html':ORIGINAL,'/data/editions/manifest.json':HISTORY}
 return {'schemaVersion':'sbos-public-release-1','sourceSHA':SOURCE,'canonicalOrigin':ORIGIN,'files':{p:hashlib.sha256(b).hexdigest() for p,b in bodies.items()},'editionManifestSHA256':hashlib.sha256(HISTORY).hexdigest()}

class CloudflareJSD(unittest.TestCase):
 def check(self,body):return verify(receipt(),SOURCE,{'/about/index.html':body,'/data/editions/manifest.json':HISTORY}.__getitem__)
 def reject(self,body):
  with self.assertRaisesRegex(ValueError,'Cloudflare content differs'):self.check(body)

 def test_plain_single_and_both_observed_terminal_orders_keep_full_page_hash(self):
  for envelope in [b'',BEACON,JSD,BEACON+JSD,JSD+BEACON]:
   with self.subTest(envelopeBytes=len(envelope)):
    rendered=page(envelope)
    self.assertEqual(normalize_public_html(rendered),ORIGINAL)
    self.assertEqual(self.check(rendered),2)

 def test_only_bounded_consistent_request_fields_may_vary(self):
  changed=JSD.replace(b'0123456789abcdef',b'fedcba9876543210').replace(base64.b64encode(b'1700000000'),base64.b64encode(b'1800000001'))
  for envelope in [BEACON+changed,changed+BEACON]:self.assertEqual(self.check(page(envelope)),2)
  for bad in [JSD.replace(b'?ray=0123456789abcdef',b'?ray=fedcba9876543210'),JSD.replace(b'0123456789abcdef',b'A'*16),JSD.replace(b'0123456789abcdef',b'a'*15),JSD.replace(b'0123456789abcdef',b'a'*10000)]:
   with self.subTest(badBytes=len(bad)):
    self.reject(page(BEACON+bad));self.reject(page(bad+BEACON))

 def test_non_numeric_noncanonical_or_unbounded_timestamp_is_not_ignored(self):
  epoch=base64.b64encode(b'1700000000')
  # The alternate padding bits decode to the same digits but are not canonical.
  noncanonical=epoch[:-3]+b'B=='
  self.assertEqual(base64.b64decode(noncanonical),b'1700000000')
  for value in [base64.b64encode(b'aaaaaaaaaa'),noncanonical,base64.b64encode(b'170000000'),base64.b64encode(b'17000000000'),b'A'*10000+b'==',b'bad!']:
   with self.subTest(valueBytes=len(value)):
    bad=JSD.replace(epoch,value);self.reject(page(BEACON+bad));self.reject(page(bad+BEACON))

 def test_vendor_program_paths_attributes_and_payload_are_literal(self):
  variants=[
   JSD.replace(b"'/cdn-cgi/challenge-platform/scripts/jsd/main.js?",b"'https://other.example/cdn-cgi/challenge-platform/scripts/jsd/main.js?"),
   JSD.replace(b'/scripts/jsd/main.js',b'/scripts/other/main.js'),
   JSD.replace(b'<script>',b'<script nonce="unreviewed">',1),
   JSD.replace(b'a.height=1',b'a.height=100'),
   JSD.replace(b'document.body.appendChild(a);',b'document.body.appendChild(a);otherCode();'),
   JSD.replace(b'window.__CF$cv$params=',b'window.otherParams='),
   JSD.replace(b'head',b'body'),
   JSD.replace(b'})();</script>',b'})();otherCode();</script>'),
  ]
  for bad in variants:
   with self.subTest(prefix=bad[:60]):
    self.reject(page(BEACON+bad));self.reject(page(bad+BEACON))

 def test_duplicate_and_triple_envelopes_are_not_repeatedly_stripped(self):
  # JSD+beacon is now independently observed and accepted above. Duplicates
  # remain invalid even when the last two blocks would be a valid permutation.
  for envelope in [BEACON+BEACON,JSD+JSD,BEACON+JSD+BEACON,JSD+BEACON+JSD,BEACON+BEACON+JSD,BEACON+JSD+JSD,JSD+BEACON+BEACON,JSD+JSD+BEACON,BEACON+JSD+BEACON+JSD]:
   with self.subTest(bytes=len(envelope)):
    bad=page(envelope)
    self.assertEqual(normalize_public_html(bad),bad)
    self.reject(bad)

 def test_misplaced_or_noncontiguous_envelopes_fail_closed(self):
  for bad in [JSD+ORIGINAL,BEACON+JSD+ORIGINAL,ORIGINAL+JSD,page(BEACON+b'<script>otherCode()</script>'+JSD),page(JSD+b'<script>otherCode()</script>'+BEACON),page(BEACON+JSD+b'<script>otherCode()</script>')]:
   with self.subTest(bytes=len(bad)):self.reject(bad)

 def test_existing_beacon_constraints_remain_strict_with_jsd_present(self):
  for bad in [BEACON.replace(b'static.cloudflareinsights.com',b'other.example'),BEACON.replace(b'1ea6993beccf4beeb1b3927d67da293f',b'0'*32),BEACON.replace(b'crossorigin="anonymous"',b'crossorigin="use-credentials"'),BEACON.replace(b'</script>',b'otherCode()</script>')]:
   self.reject(page(bad+JSD));self.reject(page(JSD+bad))

 def test_application_bytes_remain_covered_even_with_valid_vendor_envelope(self):
  for envelope in [BEACON+JSD,JSD+BEACON]:
   safe=page(envelope)
   for changed in [safe.replace(b'Published UTF-8',b'Changed UTF-8'),safe.replace(b'quote time unknown',b'quote time changed'),safe.replace(b'applicationCode()',b'changedApplicationCode()'),safe.replace(b'</main>',b'</main> '),safe+b'\n',safe.replace(b'<main>',b'<main data-extra="changed">')]:
    self.reject(changed)
   self.assertIn(b'<script data-app>applicationCode()</script>',normalize_public_html(safe))

 def test_source_identity_and_history_are_still_required(self):
  for envelope in [BEACON+JSD,JSD+BEACON]:
   bodies={'/about/index.html':page(envelope),'/data/editions/manifest.json':HISTORY}
   for field,value in [('sourceSHA','b'*40),('canonicalOrigin','https://other.example'),('schemaVersion','other')]:
    bad=copy.deepcopy(receipt());bad[field]=value
    with self.assertRaisesRegex(ValueError,'exact source'):verify(bad,SOURCE,bodies.__getitem__)
   bodies['/data/editions/manifest.json']=HISTORY+b' '
   with self.assertRaises(ValueError):verify(receipt(),SOURCE,bodies.__getitem__)
