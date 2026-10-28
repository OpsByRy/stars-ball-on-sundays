import json
from html.parser import HTMLParser
from pathlib import Path
import struct
import unittest
from urllib.parse import urljoin

ROOT=Path(__file__).resolve().parents[1]
BRANDS=('classic','violet','forest','volt')

class Head(HTMLParser):
    def __init__(self):super().__init__();self.links=[];self.scripts=[]
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if tag=='link':self.links.append(values)
        if tag=='script' and 'src' in values:self.scripts.append(values['src'])

class AppIcons(unittest.TestCase):
    def setUp(self):self.files=set(json.loads((ROOT/'site-manifest.json').read_text())['files'])

    def test_every_page_has_heritage_and_explicit_calendar_metadata(self):
        for name in sorted(n for n in self.files if n.endswith('.html')):
            page=ROOT/name;html=page.read_text();head=Head();head.feed(html)
            icons=[l for l in head.links if l.get('rel')=='icon']
            self.assertTrue(icons,name);self.assertTrue(all('/icons/heritage' in l['href'] for l in icons),name)
            touch=next(l for l in head.links if l.get('rel')=='apple-touch-icon')
            manifest=next(l for l in head.links if l.get('rel')=='manifest')
            brand=Path(name).parts[1] if name.startswith('app/') else 'classic'
            self.assertIn('calendar-'+brand+'-180.png',touch['href']);self.assertIn('manifest-'+brand+'.webmanifest',manifest['href'])
            self.assertLess(html.index('data-app-manifest'),html.index('assets/brand-theme.js'),name)
            self.assertIn('data-install-link',html,name)
            for link in [*icons,touch,manifest]:self.assertTrue((page.parent/link['href']).resolve().is_file(),name)

    def test_manifests_preserve_one_app_identity_and_project_relative_paths(self):
        prefix='https://example.com/stars-ball-on-sundays/'
        for brand in BRANDS:
            name=f'assets/icons/manifest-{brand}.webmanifest';self.assertIn(name,self.files)
            manifest=json.loads((ROOT/name).read_text());url=prefix+name
            self.assertEqual(manifest['short_name'],'SBOS');self.assertEqual(manifest['display'],'standalone')
            self.assertEqual(urljoin(url,manifest['id']),prefix);self.assertEqual(urljoin(url,manifest['scope']),prefix)
            self.assertEqual(urljoin(url,manifest['start_url']),prefix+'?app-theme='+brand)
            self.assertEqual({i['sizes'] for i in manifest['icons']},{'192x192','512x512'})
            self.assertTrue(any(i['purpose']=='maskable' for i in manifest['icons']))
            for icon in manifest['icons']:
                path=Path(name).parent/icon['src'];self.assertIn(str(path),self.files)
                data=(ROOT/path).read_bytes();self.assertEqual(data[:8],b'\x89PNG\r\n\x1a\n')
                size=struct.unpack('>II',data[16:24]);self.assertEqual(icon['sizes'],f'{size[0]}x{size[1]}')
                self.assertEqual(data[25],2,'Home-screen icons must be opaque RGB PNGs')

if __name__=='__main__':unittest.main()
