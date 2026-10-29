const test=require('node:test'),assert=require('node:assert/strict');
const prices=require('../assets/book-prices.js'),pm=require('../assets/plus-money.js');
const quote=(book,odds)=>({book,americanOdds:odds,capturedAt:'2026-10-28T18:12:00Z',operator:'>',line:14.5});
const pick={id:'fixed',market:'PTS',operator:'>=',line:15,book:'draftkings',americanOdds:-200,estimate:{winProbability:.85},bookPrices:{checkedAt:'2026-10-28T18:12:00Z',quotes:[quote('fanduel',-250),quote('draftkings',-200)]}};
test('book preference changes price without changing contracts, probabilities or saved records',()=>{
 const before=JSON.stringify(pick),fd=prices.pricedPick(pick,'fanduel'),dk=prices.pricedPick(pick,'draftkings');
 assert.equal(fd.americanOdds,-250);assert.equal(dk.americanOdds,-200);
 for(const row of [fd,dk]){assert.equal(row.id,'fixed');assert.equal(row.line,15);assert.equal(row.operator,'>=');assert.equal(row.estimate.winProbability,.85);assert.equal(row.priceFallback,false);}
 assert.equal(JSON.stringify(pick),before);
});
test('only a missing preferred quote permits fallback and explicit missing coverage never revives an old price',()=>{
 const single={...pick,bookPrices:{...pick.bookPrices,quotes:[quote('draftkings',-200)]}};
 assert.equal(prices.pricedPick(single,'fanduel').priceFallback,true);
 assert.equal(prices.pricedPick(single,'fanduel').book,'draftkings');
 assert.equal(prices.pricedPick({...pick,bookPrices:{...pick.bookPrices,quotes:[]}},'fanduel').americanOdds,null);
 assert.equal(prices.pricedPick({...pick,bookPrices:undefined,confidenceUpdate:{americanOdds:null}},'fanduel').americanOdds,null);
});
test('exclusive sections use complete exact-line coverage and both views retain the same ticket legs',()=>{
 const only=book=>({...pick,bookPrices:{...pick.bookPrices,quotes:[quote(book,-200)]}});
 assert.equal(prices.coverage({legs:[pick,pick]}),'both');
 assert.equal(prices.coverage({legs:[pick,only('fanduel')]}),'fanduel');
 assert.equal(prices.coverage({legs:[pick,only('draftkings')]}),'draftkings');
 assert.equal(prices.coverage({legs:[only('draftkings'),only('fanduel')]}),'mixed');
 const ticket={legs:[pick,pick],indicativeAmericanOdds:125,fitReasons:[],section:'plus_money'};
 const fd=pm.pricedTicket(ticket,'fanduel'),dk=pm.pricedTicket(ticket,'draftkings');
 assert.deepEqual(fd.legs.map(r=>r.id),dk.legs.map(r=>r.id));assert.notEqual(fd.indicativeAmericanOdds,dk.indicativeAmericanOdds);
 assert.match(pm.ticketRow(pm.pricedTicket({...ticket,fitReasons:[],legs:[pick,only('draftkings')]},'fanduel'),0),/DraftKings Exclusive Lines/);
});
