"""The faster public-text scan must reject exactly the same JSON strings."""
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from public_schema import text


def original_accepts(value, maximum=500):
    return isinstance(value, str) and len(value) <= maximum and not any(ord(c) < 32 for c in value)


class PublicTextValidation(unittest.TestCase):
    def equivalent(self, value, maximum=500):
        if original_accepts(value, maximum):
            self.assertIsNone(text(value, maximum))
        else:
            with self.assertRaisesRegex(ValueError, 'Invalid public text'):
                text(value, maximum)

    def test_every_ascii_control_character_is_rejected_at_any_position(self):
        for point in range(32):
            for value in [chr(point) + 'text', 'te' + chr(point) + 'xt', 'text' + chr(point)]:
                with self.subTest(point=point, value=repr(value)):
                    self.equivalent(value)

    def test_unicode_and_non_ascii_controls_keep_the_original_contract(self):
        for point in range(256):
            self.equivalent('Player ' + chr(point) + ' · saved quote')
        for value in ['Nikola Jokić', '篮球', '★ Sunday', '𝄞', '\ud800', '\udfff', '\u2028', '\u2029', '\ufeff']:
            self.equivalent(value)

    def test_empty_length_boundaries_and_invalid_types_match(self):
        for maximum in [0, 1, 100, 500]:
            for size in [0, maximum, maximum + 1]:
                self.equivalent('a' * size, maximum)
        for value in [None, True, 123, 1.5, b'text', [], {}]:
            self.equivalent(value)

    def test_deterministic_mixed_unicode_strings_match_original_predicate(self):
        rng = random.Random(20261115)
        alphabet = [chr(x) for x in range(160)] + ['é', 'ć', '·', '★', '篮', '🏀']
        for _ in range(2000):
            value = ''.join(rng.choice(alphabet) for _ in range(rng.randrange(90)))
            self.equivalent(value, rng.choice([0, 20, 50, 500]))


if __name__ == '__main__':
    unittest.main()
