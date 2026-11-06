from pathlib import Path
import tempfile,unittest
from source_copy import copy_public_source

class SourceCopyBoundary(unittest.TestCase):
 def test_root_host_outputs_and_git_are_not_duplicated(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t)/'source';root.mkdir()
   for name in ['dist','dist-cloudflare','dist-github','.git']:
    p=root/name/'large';p.parent.mkdir();p.write_bytes(b'x'*2048)
   (root/'index.html').write_text('source');dest=Path(t)/'copy';copy_public_source(root,dest)
   self.assertEqual((dest/'index.html').read_text(),'source')
   self.assertEqual({p.name for p in dest.iterdir()},{'index.html'})
 def test_ordinary_nested_source_and_canaries_are_preserved(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t)/'source';(root/'assets/dist-cloudflare').mkdir(parents=True)
   (root/'assets/dist-cloudflare/real-source.js').write_text('KEEP')
   (root/'private-canary.js').write_text('must reach publication exclusion test')
   dest=Path(t)/'copy';copy_public_source(root,dest)
   self.assertEqual((dest/'assets/dist-cloudflare/real-source.js').read_text(),'KEEP')
   self.assertEqual((dest/'private-canary.js').read_text(),'must reach publication exclusion test')
 def test_source_link_cannot_pull_external_data_into_fixture(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t)/'source';root.mkdir();outside=Path(t)/'outside';outside.write_text('PRIVATE');(root/'external').symlink_to(outside)
   with self.assertRaises(ValueError):copy_public_source(root,Path(t)/'copy')
 def test_existing_destination_never_overwritten(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t)/'source';root.mkdir();dest=Path(t)/'copy';dest.mkdir();(dest/'keep').write_text('PRESERVE')
   with self.assertRaises(FileExistsError):copy_public_source(root,dest)
   self.assertEqual((dest/'keep').read_text(),'PRESERVE')

if __name__=='__main__':unittest.main()
