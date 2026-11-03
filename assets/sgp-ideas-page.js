'use strict';
(async function () {
  const target=document.getElementById('sgp-ideas');
  try {
    const response=await fetch('../../assets/sgp-ideas.json',{cache:'no-store',credentials:'omit'});
    if (!response.ok) throw new Error('Ideas unavailable');
    const text=await response.text(); if (new TextEncoder().encode(text).length>1048576) throw new Error('Oversized ideas');
    window.SBOSSgpIdeas.render(JSON.parse(text),document,target);
  } catch (_) { target.replaceChildren(); target.textContent='SGP research ideas are unavailable. Existing pick boards and saved prices are unchanged.'; }
})();
