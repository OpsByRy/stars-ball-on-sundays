import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from public_schema import validate_book_prices

class ExactBookPrices(unittest.TestCase):
    def test_equivalent_alternate_prices_preserve_the_win_and_push_boundary(self):
        row={'operator':'>=','line':15}
        prices={'checkedAt':'2026-10-28T18:12:00Z','quotes':[{'book':'fanduel','americanOdds':-200,'operator':'>','line':14.5,'capturedAt':'2026-10-28T18:12:00Z'}]}
        validate_book_prices(prices,row)
        for line in [14,15,15.5]:
            bad=copy.deepcopy(prices);bad['quotes'][0]['line']=line
            with self.assertRaisesRegex(ValueError,'outcome or push'):validate_book_prices(bad,row)
        bad=copy.deepcopy(prices);bad['quotes'][0]['weights']=[1]
        with self.assertRaisesRegex(ValueError,'unknown'):validate_book_prices(bad,row)
        bad=copy.deepcopy(prices);bad['quotes'].append(bad['quotes'][0])
        with self.assertRaisesRegex(ValueError,'Duplicate'):validate_book_prices(bad,row)
