/* Standard odds arithmetic for the reader's calculator. No research selection logic. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.STARS_MATH=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  function decimalOdds(n){return finite(n)&&Math.abs(n)>=100?(n>0?1+n/100:1+100/Math.abs(n)):null;}
  function americanOdds(n){return finite(n)&&n>1?Math.round(n>=2?(n-1)*100:-100/(n-1)):null;}
  function formatOdds(n){return finite(n)?(n>0?'+':'')+n:'—';}
  return {decimalOdds,americanOdds,formatOdds};
});
