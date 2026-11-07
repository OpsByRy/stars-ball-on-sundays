"""Keep the full calendar on its matching gradient tile, without white padding."""
import json
from pathlib import Path
import struct
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
THEMES = ('classic', 'volt', 'violet', 'forest', 'hardwood', 'primetime', 'tealera', 'varsity', 'sunset')


def rgb_png(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, compressed = 8, bytearray()
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        kind, chunk = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + size]
        if kind == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
            assert (depth, color, interlace) == (8, 2, 0), 'Icons must be opaque RGB PNGs'
        if kind == b'IDAT':
            compressed.extend(chunk)
        pos += size + 12
    raw, stride, previous, rows = zlib.decompress(compressed), width * 3, bytearray(width * 3), []
    for y in range(height):
        start = y * (stride + 1)
        filt, row = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        for i, value in enumerate(row):
            left, above, upper_left = row[i - 3] if i >= 3 else 0, previous[i], previous[i - 3] if i >= 3 else 0
            if filt == 1:
                value += left
            elif filt == 2:
                value += above
            elif filt == 3:
                value += (left + above) // 2
            elif filt == 4:
                estimate = left + above - upper_left
                distances = [abs(estimate - v) for v in (left, above, upper_left)]
                value += (left, above, upper_left)[distances.index(min(distances))]
            else:
                assert filt == 0
            row[i] = value % 256
        rows.append(row)
        previous = row
    return width, height, rows


class FilledCalendarAppIcons(unittest.TestCase):
    def test_all_exports_reach_edges_with_calendar_colors(self):
        for theme in THEMES:
            folder = ROOT / 'assets/icons'
            manifest = json.loads((folder / f'manifest-{theme}.webmanifest').read_text())
            ink = bytes.fromhex(manifest['theme_color'][1:])
            page = bytes.fromhex(manifest['background_color'][1:])
            self.assertNotEqual(ink, b'\xff\xff\xff')
            self.assertNotEqual(page, b'\xff\xff\xff')
            for suffix, size in [('180', 180), ('192', 192), ('512', 512), ('maskable-512', 512)]:
                width, height, rows = rgb_png(folder / f'calendar-{theme}-{suffix}.png')
                self.assertEqual((width, height), (size, size))
                corners = [rows[0][:3], rows[0][-3:], rows[-1][:3], rows[-1][-3:]]
                self.assertTrue(all(c != b'\xff\xff\xff' for c in corners))
                self.assertGreater(sum(corners[0]), sum(corners[2]), 'The app highlight must be brighter than its lower vignette')
                self.assertNotEqual(corners[0], corners[2])
                if suffix != 'maskable-512':
                    y = int(height * .23)
                    left, right = int(width * .23), int(width * .79)
                    self.assertGreater(sum(rows[y][3*left:3*left+3]), sum(rows[y][3*right:3*right+3]), 'Whole-icon lighting must reach the flat logo header')

    def test_maskable_is_separate_safe_area_export(self):
        for theme in THEMES:
            folder = ROOT / 'assets/icons'
            self.assertNotEqual((folder / f'calendar-{theme}-512.png').read_bytes(),
                                (folder / f'calendar-{theme}-maskable-512.png').read_bytes())


if __name__ == '__main__':
    unittest.main()
