const test=require('node:test'),assert=require('node:assert/strict'),pub=require('../assets/publication.js');
test('new estimates drive current filters while the original forecast and price remain saved',()=>{
 const original={id:'old',player:'One',group:'research',category:'value_safe',americanOdds:-250,estimate:{winProbability:.85},confidenceUpdate:{status:'review',checkedAt:'2026-10-28T18:00:00Z',summary:'New role needs review.',americanOdds:-280,estimate:{winProbability:.72,projection:20}}};
 const before=JSON.stringify(original);
 assert.equal(pub.filterPicks([original],{minimum:80}).length,0);assert.equal(pub.filterPicks([original],{minimum:70}).length,1);
 assert.equal(pub.pricedPick(original).americanOdds,-280);assert.match(pub.confidenceDetails(original),/85.0%/);assert.match(pub.confidenceDetails(original),/72.0%/);
 assert.match(pub.confidenceDetails(original),/does not erase a pick/);assert.equal(JSON.stringify(original),before);
 const unavailable={...original,confidenceUpdate:{...original.confidenceUpdate,americanOdds:null,estimate:undefined}};
 assert.equal(pub.pricedPick(unavailable).americanOdds,null);assert.equal(pub.filterPicks([unavailable],{minimum:1}).length,0);
 assert.doesNotMatch(pub.confidenceDetails({...original,confidenceUpdate:{...original.confidenceUpdate,summary:'<script>'}}),/<script>/);
});
