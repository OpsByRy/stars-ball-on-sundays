/* Public probability/odds arithmetic. Assumptions are inputs, never fitted forecasts. */
(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(node?require('./math.js'):root.STARS_MATH,node?require('./result-utils.js'):root.STARS_RESULT_UTILS);if(node)module.exports=api;else root.SBOS_SGP_MATH=api;})(typeof window==='undefined'?this:window,function(math,contracts){
  'use strict';
  const finite=x=>typeof x==='number'&&Number.isFinite(x),prob=x=>finite(x)&&x>=0&&x<=1;
  function bounds(ps){
    if(!Array.isArray(ps)||ps.length<2||!ps.every(prob))return null;
    return {lower:Math.max(0,ps.reduce((a,b)=>a+b,0)-(ps.length-1)),upper:Math.min(...ps)};
  }
  function pairJoint(a,b,rho){
    if(!prob(a)||!prob(b)||!finite(rho)||Math.abs(rho)>1)return {error:'Enter two win estimates from 0% to 100% and a correlation from −1 to 1.'};
    const range=bounds([a,b]),base=a*b,scale=Math.sqrt(a*(1-a)*b*(1-b));
    if(scale===0)return {error:'Correlation is undefined when either win estimate is 0% or 100%. Use a joint-probability scenario instead.'};
    const minimum=(range.lower-base)/scale,maximum=(range.upper-base)/scale,joint=base+rho*scale;
    if(joint<range.lower-1e-12||joint>range.upper+1e-12)return {error:'That correlation is impossible for these win estimates.',minimumCorrelation:minimum,maximumCorrelation:maximum,bounds:range};
    return {probability:Math.max(range.lower,Math.min(range.upper,joint)),minimumCorrelation:minimum,maximumCorrelation:maximum,bounds:range,basis:'your_pair_correlation',validated:false};
  }
  function classify(legs){
    const counts=new Map();let unknown=0;
    for(const r of legs){const game=r.game?.trim()?['manual',r.date||'',r.game.trim().toLowerCase()]:(r.canonicalEventId||r.eventId)?[r.date||'',r.canonicalEventId||r.eventId]:null;if(!game){unknown++;continue;}const key=JSON.stringify(game);counts.set(key,(counts.get(key)||0)+1);}
    return {type:unknown?'unconfirmed':counts.size===1?'sgp':[...counts.values()].some(n=>n>1)?'sgp_plus':'cross_game',games:counts.size,unknownGames:unknown};
  }
  function contractIssues(legs){
    const warnings=new Set(),interval=c=>({lower:c.operator==='>='?Math.ceil(c.line):c.operator==='>'?Math.floor(c.line)+1:0,upper:c.operator==='<='?Math.floor(c.line):c.operator==='<'?Math.ceil(c.line)-1:Infinity});
    const components={PTS:['PTS'],AST:['AST'],REB:['REB'],'3PM':['3PM'],BLK:['BLK'],STL:['STL'],PRA:['PTS','REB','AST'],PA:['PTS','AST'],PR:['PTS','REB'],RA:['REB','AST']};
    if(legs.some(contracts.isVoidedLeg))return {error:'Remove voided selections and enter the revised full-ticket quote.'};
    if(new Set(legs.map(r=>r.id).filter(Boolean)).size<legs.filter(r=>r.id).length)return {error:'The same selection is included more than once.'};
    // Combine exact-event component minima before pair checks: separately feasible
    // points/rebounds legs can together exceed an upper PRA/PR/PA/RA contract.
    const groups=new Map();
    for(const r of legs){
      const event=r.canonicalEventId||r.eventId,c=contracts.normalizeContract(r);
      if(!r.playerId||!r.date||!event||!c)continue;
      const key=JSON.stringify([r.playerId,r.date,event]),g=groups.get(key)||{minimum:{PTS:0,REB:0,AST:0,'3PM':0,BLK:0,STL:0},terms:[]},x=interval(c);
      if(components[c.market].length===1)g.minimum[c.market]=Math.max(g.minimum[c.market],x.lower);
      g.terms.push({market:c.market,upper:x.upper});groups.set(key,g);
    }
    for(let i=0;i<legs.length;i++)for(let j=i+1;j<legs.length;j++){
      const a=legs[i],b=legs[j];if(!a.playerId||a.playerId!==b.playerId||!a.date||a.date!==b.date||!(a.canonicalEventId||a.eventId)||(a.canonicalEventId||a.eventId)!==(b.canonicalEventId||b.eventId))continue;
      const ac=contracts.normalizeContract(a),bc=contracts.normalizeContract(b);if(!ac||!bc)continue;
      const x=interval(ac),y=interval(bc);
      if(ac.market===bc.market){
        if(Math.max(x.lower,y.lower)>Math.min(x.upper,y.upper))return {error:'Two selections for the same player cannot win together.'};
        if(x.lower>=y.lower&&x.upper<=y.upper||y.lower>=x.lower&&y.upper<=x.upper)return {error:'Two selections are equivalent or one is already implied by the other.'};
      }else{
        const ax=components[ac.market],bx=components[bc.market];
        if(ax.every(k=>bx.includes(k))&&x.lower>y.upper||bx.every(k=>ax.includes(k))&&y.lower>x.upper)return {error:'The player’s stat totals make these selections impossible together.'};
        const subset=(a,b)=>a.every(k=>b.includes(k));
        if(subset(ax,bx)&&(x.upper===Infinity&&y.upper===Infinity&&x.lower>=y.lower||x.lower===0&&y.lower===0&&y.upper<=x.upper)||subset(bx,ax)&&(x.upper===Infinity&&y.upper===Infinity&&y.lower>=x.lower||x.lower===0&&y.lower===0&&x.upper<=y.upper))return {error:'One player-stat selection is already implied by another selection.'};
        if(ac.market==='3PM'&&bx.includes('PTS')&&x.upper===Infinity&&y.upper===Infinity&&3*x.lower>=y.lower||bc.market==='3PM'&&ax.includes('PTS')&&x.upper===Infinity&&y.upper===Infinity&&3*y.lower>=x.lower)return {error:'The points selection is already implied by the made-threes selection.'};
        if(ac.market==='3PM'&&bx.includes('PTS')&&3*x.lower>y.upper||bc.market==='3PM'&&ax.includes('PTS')&&3*y.lower>x.upper)return {error:'The made-threes requirement exceeds the permitted points total.'};
        if(ax.some(k=>bx.includes(k))||ac.market==='3PM'&&bx.includes('PTS')||bc.market==='3PM'&&ax.includes('PTS'))warnings.add('Same-player stat totals overlap; shared production needs a joint model.');
      }
    }
    for(const g of groups.values()){
      g.minimum.PTS=Math.max(g.minimum.PTS,3*g.minimum['3PM']);
      if(g.terms.some(c=>components[c.market].reduce((sum,k)=>sum+g.minimum[k],0)>c.upper))return {error:'The player’s stat totals make these selections impossible together.'};
    }
    return {error:null,warnings:[...warnings]};
  }
  function analyze(legs,{offeredOdds=null,stake=null,probabilities=[],method='none',jointProbability=null,correlation=null}={}){
    if(!Array.isArray(legs)||legs.length<2||legs.length>20)return {error:'Add between 2 and 20 selections.'};
    const check=contractIssues(legs);if(check.error)return check;
    const decimals=legs.map(r=>math.decimalOdds(r.americanOdds));
    if(decimals.some(d=>d===null))return {error:'Every selection needs valid American odds.'};
    if(offeredOdds!==null&&(!Number.isInteger(offeredOdds)||math.decimalOdds(offeredOdds)===null))return {error:'Enter valid whole-number American odds for the full ticket.'};
    const independent=decimals.reduce((a,b)=>a*b,1),quoted=math.decimalOdds(offeredOdds),validStake=finite(stake)&&stake>0&&stake<=1000000;
    const invalidMarginals=!Array.isArray(probabilities)||probabilities.some(p=>p!==null&&p!==undefined&&!prob(p));
    const range=Array.isArray(probabilities)&&probabilities.length===legs.length?bounds(probabilities):null;
    let scenario=null,error=null;
    if(method!=='none'&&invalidMarginals)error='Enter individual win estimates from 0% to 100%, or leave them blank.';
    else if(method==='pair'){
      if(legs.length!==2)error='A pair correlation cannot determine a three-or-more-leg joint probability.';
      else{const result=pairJoint(probabilities[0],probabilities[1],correlation);if(result.error)error=result.error;else scenario=result;}
    }else if(method==='joint'){
      if(!prob(jointProbability))error='Enter your joint win estimate from 0% to 100%.';
      else if(range&&(jointProbability<range.lower-1e-12||jointProbability>range.upper+1e-12))error='Your joint estimate falls outside the possible range of the individual win estimates.';
      else scenario={probability:jointProbability,basis:'your_joint_estimate',validated:false};
    }else if(method!=='none')error='Choose a supported probability scenario.';
    const p=scenario?.probability;
    return {error:null,contractWarnings:check.warnings,...classify(legs),independentDecimal:independent,independentAmerican:math.americanOdds(independent),quotedDecimal:quoted,quotedAmerican:quoted===null?null:offeredOdds,
      payout:quoted!==null&&validStake?quoted*stake:null,profit:quoted!==null&&validStake?(quoted-1)*stake:null,breakEven:quoted===null?null:1/quoted,
      quoteDifference:quoted===null?null:quoted/independent-1,scenarioError:error,scenario:scenario?{...scenario,fairDecimal:p>0?1/p:null,expectedReturnPerUnit:quoted===null?null:p*quoted-1,expectedProfit:quoted!==null&&validStake?(p*quoted-1)*stake:null}:null,
      marginalBounds:range,validatedModel:false};
  }
  return {bounds,pairJoint,classify,contractIssues,analyze};
});
