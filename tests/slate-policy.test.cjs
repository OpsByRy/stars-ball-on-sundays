'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../assets/slate-policy.js');
const row=(odds,date='2026-10-30',category='value_safe')=>({group:'research',category,date,americanOdds:odds});
const ticket=(odds,date='2026-10-30')=>({indicativeAmericanOdds:odds,legs:[row(-200,date),row(-300,date)]});
test('daily price boundaries apply prospectively without recategorizing the old two-tier record',()=>{
 for(const [price,tier] of [[-501,null],[-500,'free_throws'],[-250,'free_throws'],[-249,'floaters'],[-111,'floaters'],[-110,'lobs'],[-100,'lobs'],[100,'lobs'],[500,'lobs'],[0,null],[99,null],[null,null]])assert.equal(policy.dailyTier(row(price)),tier,String(price));
 assert.equal(policy.dailyTier(row(-110,'2026-10-29')),'legacy_layups');
 assert.equal(policy.dailyTier(row(-400,'2026-10-29','high_probability_aggressive')),'legacy_lobs');
 assert.equal(policy.dailyTitle(row(-300)),'Free Throws');
 assert.equal(policy.dailyTier({...row(-300),group:'ry'}),null);
 assert.equal(policy.dailyTier(row(120,'2026-10-30','honorable_mention')),'bench');
 assert.equal(policy.dailyTier(row(120,'2026-10-30','not_a_pick')),null);
});
test('frozen original prices survive book preference, confidence and void price overlays',()=>{
 const original=row(-300),snapshot=JSON.stringify(original),frozen=policy.freezeDaily(original);
 assert.equal(policy.dailyTier({...frozen,americanOdds:120,confidenceUpdate:{americanOdds:150}}),'free_throws');
 assert.equal(policy.freezeDaily({...frozen,americanOdds:120}).slateOriginalAmericanOdds,-300);
 assert.equal(JSON.stringify(original),snapshot);
 const frozenTicket=policy.freezeParlay(ticket(650));
 assert.equal(policy.parlayTier({...frozenTicket,indicativeAmericanOdds:101,americanOdds:101,result:{voided:true}}),'longshots');
 assert.equal(policy.freezeParlay({...frozenTicket,indicativeAmericanOdds:101}).slateOriginalAmericanOdds,650);
 const noPrice=policy.freezeDaily(row(null));assert.equal(policy.dailyTier({...noPrice,americanOdds:150}),null);
});
test('prospective parlay categories use frozen total price, not same-game status or reduced payout',()=>{
 for(const [price,tier] of [[-111,null],[-110,'layups'],[-100,'layups'],[100,'layups'],[200,'layups'],[201,'mid_range'],[499,'mid_range'],[500,'longshots'],[999,'longshots'],[1000,'logo_lottos'],[10000,'logo_lottos'],[0,null]])assert.equal(policy.parlayTier(ticket(price)),tier,String(price));
 assert.equal(policy.parlayTier({...ticket(650),section:'plus_money'}),'longshots');
 assert.equal(policy.parlayTier({...ticket(650,'2026-10-29'),section:'plus_money'}),'legacy_plus_money');
 assert.equal(policy.parlayTier({...ticket(120,'2026-10-29'),section:'longshots'}),'legacy_longshots');
 assert.equal(policy.parlayTier({...ticket(650),priceKind:'model_target'}),null);
 assert.equal(policy.parlayTitle(ticket(1100)),'Logo Lottos');
 assert.equal(policy.isCurrent({legs:[row(-200,'2026-10-29'),row(-200,'2026-10-30')]}),false);
});
test('SGP minimum accepted price clamps targets prospectively and never creates a sportsbook quote',()=>{
 assert.equal(policy.acceptableSGPPrice(-111,'2026-10-30'),false);
 assert.equal(policy.acceptableSGPPrice(-110,'2026-10-30'),true);
 assert.equal(policy.acceptableSGPPrice(250,'2026-10-30'),true);
 assert.equal(policy.acceptableSGPPrice(-300,'2026-10-29'),true);
 assert.equal(policy.minimumSGPPrice(-292,'2026-10-30'),-110);
 assert.equal(policy.minimumSGPPrice(120,'2026-10-30'),120);
 assert.equal(policy.minimumSGPPrice(-292,'2026-10-29'),-292);
 assert.equal(policy.minimumSGPPrice(null,'2026-10-30'),null);
 assert.equal(policy.acceptableSGPPrice(-50,'2026-10-30'),false);
});
