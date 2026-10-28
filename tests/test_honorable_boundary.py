import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from public_schema import validate_honorable_mentions

class HonorableBoundary(unittest.TestCase):
    def row(self,**extra):
        return {'id':'m','date':'2026-10-28','eventId':'game','playerId':'player','market':'PTS','operator':'>=','line':15,'group':'research','category':'honorable_mention','selected':False,'americanOdds':-500,'estimate':{'winProbability':.7},**extra}
    def test_probability_and_price_boundaries(self):
        validate_honorable_mentions([self.row()])
        validate_honorable_mentions([self.row(americanOdds=110)])
        for row in [self.row(americanOdds=-501),self.row(estimate={'winProbability':.6999})]:
            with self.assertRaisesRegex(ValueError,'bounds'):validate_honorable_mentions([row])
    def test_alternate_line_or_sportsbook_cannot_duplicate_selected_or_mention_family(self):
        selected=self.row(id='s',category='value_safe',book='fanduel',operator='>',line=14.5)
        mention=self.row(id='m',book='draftkings',line=16)
        with self.assertRaisesRegex(ValueError,'Duplicate'):validate_honorable_mentions([selected,mention])
        with self.assertRaisesRegex(ValueError,'Duplicate'):validate_honorable_mentions([mention,self.row(id='second',operator='<',line=20)])
