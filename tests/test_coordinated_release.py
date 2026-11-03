import copy
from datetime import datetime, timezone
import json
import shutil
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import coordinated_release as c
import build_hosts

NOW=datetime(2026,10,31,20,30,tzinfo=timezone.utc)


def save(root, name, body):
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(c.canonical(body)+b'\n')


def row(identity='p1'):
    return {'id':identity,'date':'2026-10-31','eventId':'game-'+identity,'playerId':identity,'player':'Synthetic',
      'group':'research','category':'value_safe','market':'PTS','operator':'>=','line':15,'book':'fanduel',
      'americanOdds':-200,'period':'full_game','product':'sportsbook','overtime':True,
      'capturedAt':'2026-10-31T20:00:00Z','startTime':'2026-10-31T22:00:00Z',
      'estimate':{'asOf':'2026-10-31T19:58:00Z','winProbability':.9,'pushProbability':0.,'lossProbability':.1}}


def append(root, rows, tickets=None):
    kind='editions' if tickets is None else 'plus-money';folder='data/'+kind
    b={'date':'2026-10-31','updatedAt':'2026-10-31T20:00:00Z','firstPublishedAt':None}
    if tickets is None:b.update(channel='daily',props=rows)
    else:b['tickets']=tickets
    b['updatedAt']='2026-10-31T20:'+str(len(c.read(root,folder+'/manifest.json')['editions'])).zfill(2)+':00Z'
    version=c.digest(b)[:16];b['version']=version;name='daily/2026-10-31/'+version+'.json'
    save(root,folder+'/'+name,b);manifest=c.read(root,folder+'/manifest.json')
    manifest['editions'].append({'date':b['date'],'channel':'daily','path':name,'version':version})
    save(root,folder+'/manifest.json',manifest);return b


def setup(root, rows=None):
    for folder in ('data/editions','data/plus-money'):save(root,folder+'/manifest.json',{'editions':[]})
    save(root,'data/stat-targets.json',{'targets':[]});save(root,'assets/parlay-withdrawals.json',{'withdrawals':[]})
    if rows is not None:append(root,rows)
    anchor={'schemaVersion':'sbos-release-anchor-1','acceptedSourceSHA':'a'*40,'state':c.snapshot(root)}
    save(root,c.ANCHOR_PATH,anchor);return c.file_sha(root/c.ANCHOR_PATH)


def review(root, **changes):
    anchor,state,_=c.comparison(root)
    receipt={'schemaVersion':c.SCHEMA,'anchorSHA256':c.ANCHOR_SHA256,'targetSHA256':c.semantic_identity(state),
             'reviewedAt':'2026-10-31T20:01:00Z','evidenceSHA256':{k:c.digest(k) for k in c.EVIDENCE_ROLES},
             'sgpDisposition':'no_new_sgp_qualified','experimentalPromotion':False}
    receipt.update(changes);receipt['receiptSHA256']=c.digest(receipt);save(root,c.RECEIPT_PATH,receipt);return receipt


class CoordinatedRelease(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.pin=patch.object(c,'ANCHOR_SHA256',setup(self.root,[row()]));self.pin.start()
    def tearDown(self):self.pin.stop();self.temp.cleanup()
    def added(self):append(self.root,[row(),row('p2')])
    def test_marker_omission_cannot_bypass_new_selections(self):
        self.added()
        with self.assertRaisesRegex(ValueError,'Missing'):c.verify(self.root,NOW)
    def test_result_only_append_needs_no_new_review_after_tip(self):
        r=row();r.update(result={'actual':0,'eventStatus':'final','statisticalOutcome':'loss'})
        append(self.root,[r]);self.assertEqual(c.verify(self.root,datetime(2026,11,1,tzinfo=timezone.utc))['status'],'unchanged')
    def test_posting_clock_changes_are_not_result_only_amendments(self):
        r=row();r['postedAt']='2026-10-31T20:20:00Z';append(self.root,[r])
        with self.assertRaisesRegex(ValueError,'Missing'):c.verify(self.root,NOW)
        original={'date':'2026-10-31','firstPublishedAt':'2026-10-31T20:05:00Z','props':[row()]}
        for field in ('firstPublishedAt','favoritesPostedAt','personalPublication'):
            amended=copy.deepcopy(original)
            amended[field]=({'recordedAt':'2026-10-31T19:00:00Z','publishedAt':'2026-10-31T21:00:00Z'} if field=='personalPublication' else '2026-10-31T21:00:00Z')
            self.assertNotEqual(c.digest(c.document_semantic(original,'edition')),c.digest(c.document_semantic(amended,'edition')))
        ticket={'id':'t','postedAt':'2026-10-31T20:05:00Z','legs':[row()]};amended=copy.deepcopy(ticket);amended['postedAt']='2026-10-31T21:00:00Z'
        self.assertNotEqual(c.digest(c.ticket_semantic(ticket)),c.digest(c.ticket_semantic(amended)))
    def test_result_source_identity_cannot_change_without_review(self):
        for field,value in [('eventId','999'),('athleteId','999'),('expectedTeam','BBB'),('provider','other')]:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();r=row();r['resultSource']={'eventId':'123','athleteId':'456','expectedTeam':'AAA','provider':'espn'}
                pin=setup(root,[r]);r['resultSource'][field]=value
                with patch.object(c,'ANCHOR_SHA256',pin):
                    append(root,[r])
                    with self.assertRaisesRegex(ValueError,'Missing'):c.verify(root,NOW)
    def test_result_refresh_integer_float_roundtrip_retains_semantic_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();r=row();r['line']=15.0;r['estimate']['pushProbability']=0.0
            pin=setup(root,[r]);r['line']=15;r['estimate']['pushProbability']=0
            r['result']={'actual':0,'eventStatus':'live','statisticalOutcome':'pending'}
            with patch.object(c,'ANCHOR_SHA256',pin):
                append(root,[r]);self.assertEqual(c.verify(root,NOW)['status'],'unchanged')
        self.assertNotEqual(c.digest({'value':True}),c.digest({'value':1}))
    def test_quote_age_30_minutes_and_later_retains_real_clocks(self):
        self.added();review(self.root)
        for minute in (30,59):
            self.assertEqual(c.verify(self.root,NOW.replace(minute=minute))['status'],'reviewed')
        saved=c.read(self.root,'data/editions/'+c.read(self.root,'data/editions/manifest.json')['editions'][-1]['path'])
        self.assertEqual(saved['props'][0]['capturedAt'],'2026-10-31T20:00:00Z')
    def test_old_review_cannot_cover_changed_contract_price_probability_or_clock(self):
        for field,value in [('line',16),('book','draftkings'),('americanOdds',-150),('capturedAt','2026-10-31T20:29:00Z'),('overtime',False),('estimate',{'winProbability':.99})]:
            with self.subTest(field=field):
                with tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp).resolve();pin=setup(root,[row()])
                    with patch.object(c,'ANCHOR_SHA256',pin):
                        append(root,[row(),row('p2')]);review(root);r=row('p2');r[field]=value;append(root,[row(),r])
                        with self.assertRaisesRegex(ValueError,'actual staged revision'):c.verify(root,NOW)
    def test_missing_evidence_or_activation_or_future_review_rejects(self):
        self.added()
        for change in ({'evidenceSHA256':{}},{'sgpDisposition':'qualified'},{'experimentalPromotion':True},{'reviewedAt':'2026-11-01T00:00:00Z'}):
            with self.subTest(change=change):
                review(self.root,**change)
                with self.assertRaises(ValueError):c.verify(self.root,NOW)
    def test_new_ticket_membership_changes_require_exact_review_without_markers(self):
        append(self.root,[],tickets=[{'id':'t','legs':[row(),row('p2')],'indicativeAmericanOdds':125}]);review(self.root)
        append(self.root,[],tickets=[{'id':'t','legs':[row(),row('p3')],'indicativeAmericanOdds':125}])
        with self.assertRaisesRegex(ValueError,'actual staged revision'):c.verify(self.root,NOW)
    def test_pregame_review_does_not_authorize_first_publication_after_tip(self):
        self.added();review(self.root)
        with self.assertRaises(ValueError):c.verify(self.root,NOW.replace(hour=22))
    def test_posted_at_alone_cannot_fake_prior_publication(self):
        r=row('p2');r['postedAt']='2026-10-31T20:20:00Z';append(self.root,[row(),r]);review(self.root)
        with self.assertRaises(ValueError):c.verify(self.root,NOW.replace(hour=22))
    def test_exact_reviewed_publication_confirmation_allows_later_results(self):
        self.added();r=review(self.root)
        proof={'schemaVersion':'sbos-release-publication-1','targetSHA256':r['targetSHA256'],'reviewSHA256':r['receiptSHA256'],
               'publishedAt':'2026-10-31T20:40:00Z','sourceSHA':'b'*40,'deploymentId':'synthetic','verificationSHA256':'c'*64}
        save(self.root,c.CONFIRMATION_PATH,proof)
        self.assertEqual(c.verify(self.root,NOW.replace(hour=22))['status'],'reviewed')
        for change in ({'targetSHA256':'0'*64},{'publishedAt':'2026-10-31T22:00:00Z'},{'reviewSHA256':'0'*64}):
            save(self.root,c.CONFIRMATION_PATH,{**proof,**change})
            with self.assertRaises(ValueError):c.verify(self.root,NOW.replace(hour=22))
    def test_anchor_and_immutable_editions_and_manifest_prefix_preserved(self):
        anchor=c.read(self.root,c.ANCHOR_PATH);name=next(iter(anchor['state']['immutable']))
        original=(self.root/name).read_bytes();(self.root/name).write_bytes(original+b' ')
        with self.assertRaisesRegex(ValueError,'immutable edition changed'):c.verify(self.root,NOW)
        (self.root/name).write_bytes(original);save(self.root,'data/editions/manifest.json',{'editions':[]})
        with self.assertRaisesRegex(ValueError,'removed/reordered'):c.verify(self.root,NOW)
    def test_anchor_cannot_be_replaced_to_approve_the_staged_data(self):
        self.added();save(self.root,c.ANCHOR_PATH,{'schemaVersion':'sbos-release-anchor-1','state':c.snapshot(self.root)})
        with self.assertRaisesRegex(ValueError,'anchor changed'):c.verify(self.root,NOW)
    def test_changed_selection_in_intermediate_edition_is_not_hidden_by_latest(self):
        self.added();append(self.root,[row()])
        with self.assertRaises(ValueError):c.verify(self.root,NOW)
    def test_restoring_a_previously_accepted_variant_still_changes_the_latest_binding(self):
        self.added();anchor={'schemaVersion':'sbos-release-anchor-1','state':c.snapshot(self.root)}
        save(self.root,c.ANCHOR_PATH,anchor)
        with patch.object(c,'ANCHOR_SHA256',c.file_sha(self.root/c.ANCHOR_PATH)):
            append(self.root,[row()])
            with self.assertRaisesRegex(ValueError,'Missing'):c.verify(self.root,NOW)

    def test_symlink_input_rejected(self):
        p=self.root/c.ANCHOR_PATH;raw=p.read_bytes();p.unlink();q=self.root/'other.json';q.write_bytes(raw);p.symlink_to(q)
        with self.assertRaisesRegex(ValueError,'linked'):c.verify(self.root,NOW)
    def test_artifact_tampering_extra_files_and_nested_receipts_rejected(self):
        artifact=self.root/'cf';artifact.mkdir();(artifact/'index.html').write_text('public')
        shutil.copytree(self.root/'data',artifact/'data');shutil.copytree(self.root/'assets',artifact/'assets')
        verdict=c.verify(self.root,NOW)
        receipt={'sourceSHA':'a'*40,'canonicalOrigin':'https://starsballonsundays.com','coordinatedRelease':verdict,'files':{'/'+p.relative_to(artifact).as_posix():c.file_sha(p) for p in artifact.rglob('*') if p.is_file()}}
        save(artifact,'_sbos-release.json',receipt)
        with patch.object(c,'verify_artifact_source'),patch.object(c.subprocess,'check_output',side_effect=lambda args,**kw:'' if 'status' in args else 'a'*40):
            self.assertEqual(c.verify_artifact(self.root,artifact),verdict)
            for name in ('index.html','extra.js','nested/_sbos-release.json'):
                target=artifact/name;prior=target.read_bytes() if target.exists() else None;target.parent.mkdir(exist_ok=True);target.write_text('tampered')
                with self.assertRaisesRegex(ValueError,'inventory or bytes'):c.verify_artifact(self.root,artifact)
                if prior is not None:target.write_bytes(prior)
                else:target.unlink()
    def test_rewriting_both_selection_artifact_and_receipt_does_not_bypass_source_binding(self):
        artifact=self.root/'cf';shutil.copytree(self.root/'data',artifact/'data');shutil.copytree(self.root/'assets',artifact/'assets')
        target=next((artifact/'data/editions').rglob('*json'))
        target.write_text(target.read_text()+' {}')
        verdict=c.verify(self.root,NOW)
        receipt={'sourceSHA':'a'*40,'canonicalOrigin':'https://starsballonsundays.com','coordinatedRelease':verdict,
            'files':{'/'+p.relative_to(artifact).as_posix():c.file_sha(p) for p in artifact.rglob('*') if p.is_file()}}
        save(artifact,'_sbos-release.json',receipt)
        with patch.object(c.subprocess,'check_output',side_effect=lambda args,**kw:'' if 'status' in args else 'a'*40):
            with self.assertRaisesRegex(ValueError,'selection data differs'):c.verify_artifact(self.root,artifact)

    def test_artifact_verification_rechecks_tip_after_transport_validation(self):
        artifact=self.root/'cf';artifact.mkdir();verdict=c.verify(self.root,NOW)
        save(artifact,'_sbos-release.json',{'sourceSHA':'a'*40,'canonicalOrigin':'https://starsballonsundays.com','coordinatedRelease':verdict,'files':{}})
        with patch.object(c,'verify',side_effect=[verdict,ValueError('crossed tip')]), patch.object(c,'verify_selection_transport'), patch.object(c,'verify_artifact_source'), patch.object(c.subprocess,'check_output',side_effect=lambda args,**kw:'' if 'status' in args else 'a'*40):
            with self.assertRaisesRegex(ValueError,'crossed tip'):c.verify_artifact(self.root,artifact)

    def test_dirty_or_ungated_artifact_rejected(self):
        artifact=self.root/'cf';artifact.mkdir();save(artifact,'_sbos-release.json',{'sourceSHA':'a'*40,'canonicalOrigin':'https://starsballonsundays.com','files':{}})
        with patch.object(c.subprocess,'check_output',return_value='dirty'):
            with self.assertRaisesRegex(ValueError,'Commit'):c.verify_artifact(self.root,artifact)
        with patch.object(c.subprocess,'check_output',side_effect=lambda args,**kw:'' if 'status' in args else 'a'*40):
            with self.assertRaisesRegex(ValueError,'not gated'):c.verify_artifact(self.root,artifact)

    def test_clean_checkout_commit_change_during_artifact_verification_rejected(self):
        artifact=self.root/'cf';artifact.mkdir();verdict=c.verify(self.root,NOW)
        save(artifact,'_sbos-release.json',{'sourceSHA':'a'*40,'canonicalOrigin':'https://starsballonsundays.com','coordinatedRelease':verdict,'files':{}})
        heads=iter(['a'*40,'b'*40])
        with patch.object(c,'verify_selection_transport'),patch.object(c,'verify_artifact_source'),patch.object(c.subprocess,'check_output',side_effect=lambda args,**kw:'' if 'status' in args else next(heads)):
            with self.assertRaisesRegex(ValueError,'Source commit changed'):c.verify_artifact(self.root,artifact)

if __name__=='__main__':unittest.main()
