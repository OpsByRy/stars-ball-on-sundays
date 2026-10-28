'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),theme=require('../assets/brand-theme.js');

test('first app launch uses the chosen colorway and later launches keep saved preferences',()=>{
  assert.deepEqual(theme.initialPreference(null,'violet'),{brand:'violet',appearance:'system'});
  assert.deepEqual(theme.initialPreference({brand:'volt',appearance:'light'},'classic'),{brand:'volt',appearance:'light'});
  assert.deepEqual(theme.initialPreference({brand:'classic',appearance:'dark'},null,'forest'),{brand:'forest',appearance:'dark'});
  assert.deepEqual(theme.initialPreference(null,'../../secret','__proto__'),{brand:'classic',appearance:'system'});
});

test('icon URLs stay inside the project prefix for every theme and reject unknown names',()=>{
  const base=new URL('https://example.com/stars-ball-on-sundays/');
  for(const brand of Object.keys(theme.BRANDS)){
    const urls=theme.iconURLs(brand,base);
    assert.equal(urls.install,base.href+'app/'+brand+'/');
    assert.equal(urls.manifest,base.href+'assets/icons/manifest-'+brand+'.webmanifest');
    assert.equal(urls.touch,base.href+'assets/icons/calendar-'+brand+'-180.png');
  }
  assert.match(theme.iconURLs('https://evil.test/',base).touch,/calendar-classic-180\.png$/);
});

function browser({stored=null,search='',installBrand}={}){
  const events={},documentEvents={},writes=[],reads=[],manifest={},touch={},preview={},install={};
  const nodes={'[data-app-manifest]':[manifest],'[data-touch-icon]':[touch],'[data-app-icon-preview]':[preview],'[data-install-link]':[install]};
  const document={readyState:'loading',currentScript:{src:'https://example.com/sbos/assets/brand-theme.js'},documentElement:{dataset:installBrand?{installBrand}:{}},
    querySelectorAll:selector=>nodes[selector]||[],querySelector:()=>null,getElementById:()=>null,addEventListener:(name,fn)=>{documentEvents[name]=fn;}};
  const window={location:{search},localStorage:{getItem:key=>{reads.push(key);return stored;},setItem:(key,value)=>writes.push([key,value])},
    matchMedia:()=>({matches:true,addEventListener:()=>{}}),addEventListener:(name,fn)=>{events[name]=fn;}};
  Object.defineProperty(window,'sessionStorage',{get(){throw Error('Calculator storage must remain untouched');}});
  theme.init(window,document);return {events,document,manifest,touch,preview,install,reads,writes};
}

test('stored appearance updates iOS icons, Android manifests, and setup links together',()=>{
  const b=browser({stored:JSON.stringify({brand:'volt',appearance:'light'})});
  assert.deepEqual(b.reads,[theme.KEY]);assert.equal(b.document.documentElement.dataset.mode,'light');
  assert.match(b.manifest.href,/manifest-volt\.webmanifest$/);assert.match(b.touch.href,/calendar-volt-180\.png$/);assert.match(b.install.href,/app\/volt\/$/);
  for(const brand of Object.keys(theme.BRANDS)){
    b.events.storage({key:theme.KEY,newValue:JSON.stringify({brand,appearance:'dark'})});
    assert.match(b.preview.src,new RegExp('calendar-'+brand+'-192\\.png$'));
    assert.equal(b.preview.alt,theme.BRANDS[brand]+' Calendar home-screen icon');
    assert.equal(b.document.documentElement.dataset.brand,brand);
  }
  const before=b.manifest.href;b.events.storage({key:'some-calculator-state',newValue:'{}'});assert.equal(b.manifest.href,before);
});

test('new app storage gets its install color and static setup pages retain the declared icon',()=>{
  const launch=browser({search:'?app-theme=forest'});
  assert.equal(launch.document.documentElement.dataset.brand,'forest');assert.equal(launch.writes[0][0],theme.KEY);
  const setup=browser({stored:JSON.stringify({brand:'volt',appearance:'light'}),installBrand:'violet'});
  assert.match(setup.touch.href,/calendar-violet-180\.png$/);
  setup.events.storage({key:theme.KEY,newValue:JSON.stringify({brand:'forest',appearance:'dark'})});
  assert.match(setup.touch.href,/calendar-violet-180\.png$/);
});
