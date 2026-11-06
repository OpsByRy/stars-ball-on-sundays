import copy
import unittest
import test_sgp_research as original
from test_sgp_research import seal

class JointModelContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        original.SGPResearchContract.setUpClass.__func__(cls)

    check = original.SGPResearchContract.check

    def model(self):
        return dict(status='experimental',reason=None,modelVersion='paired-test-1',estimatedAt=self.body['assembledAt'],inputCutoff=self.body['sourceSelectionAt'],winProbability=.4,pushProbability=0,lossProbability=.6,fairAmericanOdds=150,sampleGames=30,limitations=['Experimental and uncalibrated; settlement is unverified.'])

    def augmented(self):
        b=copy.deepcopy(self.body)
        b['suggestions'][0]['jointModel']=self.model()
        return b

    def test_optional_estimate_preserves_originals(self):
        b=self.augmented(); self.check(seal(b))
        self.assertEqual(b['suggestions'][0]['legs'],self.body['suggestions'][0]['legs'])
        for a in b['suggestions']:
            self.assertIsNone(a['combinedQuote']);self.assertIsNone(a['ticketEV']);self.assertIsNone(a['jointWinProbability']);self.assertIs(a['betReady'],False)

    def test_push_has_no_fair_price(self):
        b=self.augmented();b['suggestions'][0]['jointModel'].update(pushProbability=.1,lossProbability=.5,fairAmericanOdds=None)
        self.check(seal(b))
        b['suggestions'][0]['jointModel']['fairAmericanOdds']=125
        with self.assertRaises(ValueError):self.check(seal(b))

    def test_unavailable_requires_reason_and_null_numbers(self):
        b=self.augmented();m=b['suggestions'][0]['jointModel'];m.update(status='unavailable',reason='No paired history',modelVersion=None)
        for k in ('winProbability','pushProbability','lossProbability','fairAmericanOdds','sampleGames'):m[k]=None
        self.check(seal(b));m['reason']=None
        with self.assertRaises(ValueError):self.check(seal(b))

    def test_invalid_models_fail_closed(self):
        for key,value in [('status','ready'),('reason','unsupported'),('modelVersion',None),('estimatedAt','2099-01-01T00:00:00Z'),('inputCutoff','2099-01-01T00:00:00Z'),('winProbability',True),('lossProbability',.7),('fairAmericanOdds',149),('sampleGames',0),('sampleGames',True),('limitations',[]),('limitations',['<script>'])]:
            with self.subTest(key=key,value=value):
                b=self.augmented();b['suggestions'][0]['jointModel'][key]=value
                with self.assertRaises(ValueError):self.check(seal(b))
        for value in (float('nan'),float('inf'),-float('inf')):
            b=self.augmented();b['suggestions'][0]['jointModel']['winProbability']=value
            with self.assertRaises(ValueError):self.check(seal(b))

if __name__=='__main__':unittest.main()
