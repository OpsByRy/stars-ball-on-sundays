"""Public version/effective-date checks for the tiered F5 selector."""
import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import public_schema as schema

def row(p=.70, odds=-200, category="high_probability_aggressive", day="2026-11-07"):
    return {"id":"research-x","date":day,"player":"Example Player","playerId":"nba:1",
            "eventId":"nba:0022600001","canonicalEventId":"nba:0022600001","market":"PTS",
            "operator":">=","line":10,"group":"research","category":category,
            "americanOdds":odds,"selected":category!="honorable_mention",
            "estimate":{"winProbability":p,"pushProbability":0.,"lossProbability":1-p,
                        "status":"provisional"}}
def edition(r, policy=True):
    b={"schemaVersion":"public-1","channel":"daily","date":r["date"],
       "timezone":"America/New_York","props":[r]}
    if policy:b["selectionPolicy"]=schema.TIERED_SELECTION_POLICY
    return b
class TieredSelectionTests(unittest.TestCase):
    def test_main_boundary(self):
        schema.validate_edition(edition(row()))
        with self.assertRaises(ValueError):schema.validate_edition(edition(row(.7-1e-10)))
    def test_lobs_boundary(self):
        schema.validate_edition(edition(row(.65,100)))
        with self.assertRaises(ValueError):schema.validate_edition(edition(row(.65-1e-10,100)))
    def test_bench_boundary(self):
        schema.validate_edition(edition(row(.6,-110,"honorable_mention")))
        with self.assertRaises(ValueError):schema.validate_edition(edition(row(.6-1e-10,-110,"honorable_mention")))
    def test_old_policy_floor_unchanged(self):
        with self.assertRaises(ValueError):schema.validate_edition(edition(row(.69,-110,"honorable_mention"),False))
        schema.validate_edition(edition(row(.7,-110,"honorable_mention"),False))
    def test_version_and_effective_date(self):
        b=edition(row(day="2026-11-06"))
        with self.assertRaises(ValueError):schema.validate_edition(b)
        b=edition(row());b["selectionPolicy"]="unknown"
        with self.assertRaises(ValueError):schema.validate_edition(b)
        b=edition(row());b["channel"]="sunday"
        with self.assertRaises(ValueError):schema.validate_edition(b)
    def test_ev_all_tracks(self):
        for r in [row(.7,-300),row(.6,-200,"honorable_mention")]:
            with self.assertRaises(ValueError):schema.validate_edition(edition(r))
    def test_push_probability_is_not_a_win(self):
        r=row(.7,-300);r["estimate"].update(pushProbability=.1,lossProbability=.2)
        schema.validate_edition(edition(r))
        r["estimate"].update(winProbability=.6,pushProbability=.2)
        with self.assertRaises(ValueError):schema.validate_edition(edition(r))
    def test_bench_not_pick_or_duplicate(self):
        r=row(.6,-110,"honorable_mention");r["selected"]=True
        with self.assertRaises(ValueError):schema.validate_edition(edition(r))
        b=edition(row());r=row(.6,-110,"honorable_mention");r["id"]="bench";b["props"].append(r)
        with self.assertRaises(ValueError):schema.validate_edition(b)
    def test_board_selected_flag_required(self):
        r=row();r["selected"]=False
        with self.assertRaises(ValueError):schema.validate_edition(edition(r))
    def test_board_ranges_bench_broader(self):
        for odds in [-100,161]:
            with self.assertRaises(ValueError):schema.validate_edition(edition(row(.8,odds)))
            schema.validate_edition(edition(row(.8,odds,"honorable_mention")))
    def test_research_not_a_pick_unchanged(self):
        schema.validate_edition(edition(row(.3,-300,"not_a_pick")))
    def test_old_edition_unchanged(self):
        b=edition(row(.61,-110,day="2026-11-06"),False);original=copy.deepcopy(b)
        schema.validate_edition(b);self.assertEqual(b,original)
if __name__=="__main__":unittest.main()
