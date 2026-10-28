const test=require('node:test');const assert=require('node:assert/strict');
const pm=require('../assets/plus-money.js');
test('publication paths reject traversal and identity changes',()=>{
 const e={date:'2026-10-28',version:'0123456789abcdef',path:'2026-10-28/0123456789abcdef.json'};
 assert.equal(pm.safePath(e),e.path);
 assert.throws(()=>pm.safePath({...e,path:'../../private.json'}));
 assert.throws(()=>pm.safePath({...e,version:'wrong'}));
});
test('filters use only the published ticket membership',()=>{
 const a={book:'fanduel',id:'one'},b={book:'draftkings',id:'two'};
 assert.deepEqual(pm.visibleTickets({tickets:[a,b]},'fanduel'),[a]);
 assert.deepEqual(pm.visibleTickets({tickets:[a,b]}),[a,b]);
});
test('contracts and consumer copy escape text and distinguish indicative price',()=>{
 assert.equal(pm.label({operator:'>=',line:15,market:'PTS'}),'15+ points');
 const leg={player:'<script>x</script>',team:'A',opponent:'B',operator:'>',line:14.5,market:'PTS',americanOdds:-300,capturedAt:'2026-10-28T17:00:00Z',estimate:{winProbability:.85,asOf:'2026-10-28T12:48:00Z'}};
 const html=pm.card({book:'fanduel',legs:[leg,leg],indicativeAmericanOdds:110,fitReasons:['Reviewed.']},0);
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('Estimated combined price'));
 assert.ok(html.includes('No verified combined win probability'));
});
