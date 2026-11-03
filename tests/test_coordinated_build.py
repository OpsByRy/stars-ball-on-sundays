"""Publication entry-point integration on synthetic source/artifacts."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from test_coordinated_release import setup, row, append
import coordinated_release as c
import build_hosts as h


class CoordinatedBuild(unittest.TestCase):
    def test_publish_marker_omission_stops_before_building_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();pin=setup(root,[row()]);append(root,[row(),row('p2')])
            (root/'hosting-policy.json').write_text((Path(h.__file__).parents[1]/'hosting-policy.json').read_text())
            with patch.object(c,'ANCHOR_SHA256',pin),patch.object(h,'__file__',str(root/'scripts/build_hosts.py')),patch('sys.argv',['build_hosts.py','--publish']),patch.object(h.subprocess,'check_output',return_value='a'*40),patch.object(h.build,'build') as build:
                with self.assertRaisesRegex(ValueError,'Missing'):h.main()
                build.assert_not_called()

    def test_unchanged_results_publish_path_rechecks_and_embeds_exact_gate_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();pin=setup(root,[row()]);r=row();r['result']={'eventStatus':'final','actual':0};append(root,[r])
            (root/'hosting-policy.json').write_text((Path(h.__file__).parents[1]/'hosting-policy.json').read_text())
            def assemble(*args):
                p=root/'dist-cloudflare/_sbos-release.json';p.parent.mkdir();p.write_text('{}');return {'sourceSHA':'a'*40}
            with patch.object(c,'ANCHOR_SHA256',pin),patch.object(h,'__file__',str(root/'scripts/build_hosts.py')),patch('sys.argv',['build_hosts.py','--publish']),patch.object(h.subprocess,'check_output',return_value='a'*40),patch.object(h.build,'build') as build,patch.object(h,'assemble',side_effect=assemble),patch.object(h,'verify_coordinated_release',wraps=c.verify) as guard:
                h.main();build.assert_called_once_with(root,publish=True);self.assertEqual(guard.call_count,2)
                self.assertEqual(json.loads((root/'dist-cloudflare/_sbos-release.json').read_text())['coordinatedRelease']['status'],'unchanged')

if __name__=='__main__':unittest.main()
