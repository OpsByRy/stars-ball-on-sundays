'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');const vm=require('node:vm');const path=require('node:path');
test('the hosting build browser handoff preserves the raw query/fragment and enforces known routes/origin',()=>{
  const script=execFileSync(process.env.SBOS_PYTHON||'python3',['-c',"import sys;sys.path.insert(0,'scripts');from build_hosts import redirect_script;print(redirect_script({'/stars-ball-on-sundays/daily/':'/daily/'}))"],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  const context={module:{exports:{}},URL};vm.runInNewContext(script,context);const api=context.module.exports;
  assert.equal(api.destination('https://opsbyry.github.io/stars-ball-on-sundays/daily/?date=2026-10-30&x=a%2Bb+c&x=2#lobs'),'https://starsballonsundays.com/daily/?date=2026-10-30&x=a%2Bb+c&x=2#lobs');
  for(const input of ['https://evil.example/stars-ball-on-sundays/daily/','https://opsbyry.github.io/stars-ball-on-sundays-evil/daily/','https://opsbyry.github.io/stars-ball-on-sundays/unknown/'])assert.equal(api.destination(input),null);
});
