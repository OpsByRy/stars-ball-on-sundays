from datetime import datetime
from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build import assert_publication_time,assert_personal_estimates
class ReleaseWindow(unittest.TestCase):
    def test_eastern_10am_boundary_in_summer_and_winter(self):
        for day,before,after in [('2026-10-29','2026-10-29T13:59:59+00:00','2026-10-29T14:00:00+00:00'),('2026-11-02','2026-11-02T14:59:59+00:00','2026-11-02T15:00:00+00:00')]:
            entries=[{'channel':'daily','date':day}]
            with self.assertRaisesRegex(ValueError,'10:00 AM'):assert_publication_time(entries,datetime.fromisoformat(before))
            assert_publication_time(entries,datetime.fromisoformat(after))
    def test_old_results_allowed_before_10_but_future_daily_boards_blocked(self):
        now=datetime.fromisoformat('2026-10-29T12:00:00+00:00')
        assert_publication_time([{'channel':'daily','date':'2026-10-28'}],now)
        with self.assertRaises(ValueError):assert_publication_time([{'channel':'daily','date':'2026-10-30'}],now)
        with self.assertRaises(ValueError):assert_publication_time([],datetime(2026,10,29))
    def test_personal_posts_require_probabilities_and_projection(self):
        body={'props':[{'group':'ry','player':'Personal pick'}]}
        with self.assertRaisesRegex(ValueError,'probabilities and projections'):assert_personal_estimates(body)
        body['props'][0]['estimate']={'projection':10,'winProbability':.7,'pushProbability':0,'lossProbability':.3,'asOf':'2026-10-28T14:00:00Z','status':'provisional'}
        assert_personal_estimates(body)
