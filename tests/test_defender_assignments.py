import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from career_schema import validate_defender_index
class AssignmentTest(unittest.TestCase):
    def valid(self):
        return {'schemaVersion':'public-career-defender-games-index-1','asOfDate':'2026-11-20','matchups':[{'playerId':'nba:1','defenderId':'nba:2','path':'1/2/1234567890abcdef.json','version':'1234567890abcdef'}],'assignments':[{'playerId':'nba:1','player':'Example Player','date':'2026-11-20','eventId':'nba:0022600050','team':'DEN','opponent':'HOU','startTime':'2026-11-21T03:00:00Z','asOf':'2026-11-20T21:00:00Z','rosterAsOf':'2026-11-20T15:00:00Z','availabilityAsOf':'2026-11-20T20:45:00Z','availabilitySource':'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-20_03_45PM.pdf','trackingCapturedAt':'2026-11-02T21:00:00Z','defender':{'playerId':'nba:2','player':'Example Defender','through':'2026-11-01','source':'https://www.nba.com/stats/player/1/head-to-head','history':[],'coverage':{'requestedFromSeason':'2026-27','seasonsCovered':['2026-27'],'missingSeasons':[]}}}]}
    def test_valid_exact_matchup(self):validate_defender_index(self.valid())
    def test_private_fields_cannot_cross_boundary(self):
        b=self.valid();b['assignments'][0]['features']={'weights':[1,2]}
        with self.assertRaises(ValueError):validate_defender_index(b)
    def test_missing_history_reference_and_future_evidence_fail(self):
        b=self.valid();b['matchups']=[]
        with self.assertRaises(ValueError):validate_defender_index(b)
        b=self.valid();b['assignments'][0]['rosterAsOf']='2026-11-21T04:00:00Z'
        with self.assertRaises(ValueError):validate_defender_index(b)
    def test_old_index_without_assignments_remains_compatible(self):
        b=self.valid();del b['assignments'];validate_defender_index(b)
