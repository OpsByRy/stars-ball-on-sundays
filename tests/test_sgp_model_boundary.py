import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from plus_money_schema import validate_model_targets

def target():
    legs=[{'id':str(i),'date':'2026-10-29','player':'Player '+str(i),'playerId':'nba:'+str(i),
        'eventId':'nba:0022600144','market':m,'operator':'>=','line':n,'group':'research',
        'startTime':'2026-10-30T00:00:00Z','estimate':{'status':'provisional','asOf':'2026-10-29T23:35:00Z',
        'winProbability':.9,'pushProbability':0,'lossProbability':.1}}
        for i,m,n in [(1,'PTS',10),(2,'REB',4)]]
    return {'id':'target','legs':legs,'status':'provisional','priceKind':'model_target',
        'compatibility':'Scoring and rebounding are assessed jointly in the same game.',
        'jointEstimate':{'asOf':'2026-10-29T23:40:00Z','winProbability':.82,'pushProbability':0,'lossProbability':.18,
        'fairAmericanOdds':-456,'minimumAmericanOdds':-300,'lowerProbability':.72,'upperProbability':.88,
        'sampleGames':125,'calibrationNote':'Provisional; limited calibration evidence for this probability range.'}}

class ModelTargetBoundary(unittest.TestCase):
    def test_fair_model_target_is_accepted_without_an_offered_quote(self):
        t=target();validate_model_targets([t],'2026-10-29')
        t['legs'][1]['playerId']=t['legs'][0]['playerId']
        validate_model_targets([t],'2026-10-29') # Same player/different stat is allowed.
    def test_quote_private_fields_pushes_and_impossible_joint_forecasts_fail_closed(self):
        base=target()
        for change in [lambda t:t.update(indicativeAmericanOdds=120),
            lambda t:t['jointEstimate'].update(privateResiduals=[1,2]),
            lambda t:t['jointEstimate'].update(winProbability=.95,lossProbability=.05,fairAmericanOdds=-1900),
            lambda t:t['legs'][1].update(eventId='nba:0022600145'),
            lambda t:t['jointEstimate'].update(asOf='2026-10-30T00:10:00Z'),
            lambda t:t['legs'][1]['estimate'].update(pushProbability=.1,lossProbability=0)]:
            t=copy.deepcopy(base);change(t)
            with self.assertRaises(ValueError):validate_model_targets([t],'2026-10-29')

if __name__=='__main__':unittest.main()
