const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm');
const M=require('../natija-model.js');
test('legacy migration preserves reminders and unknown fields; is idempotent',()=>{
 const t={id:1,date:'2026-10-23',time:'09:00',completed:false,reminderMinutes:10,reminderVersion:7,alarmNotified:true,custom:'keep'};
 const n=M.normalize(t);assert.deepEqual(M.normalize(n),n);
 for(const key of Object.keys(t))assert.equal(n[key],t[key]);
 assert.equal(n.status,'todo');assert.deepEqual(n.subtasks,[]);assert.equal(n.endTime,'');
 assert.equal(M.normalize({...t,completed:true,status:'doing'}).status,'done');
});
test('time validation and legacy interval at midnight boundary',()=>{
 assert.equal(M.validRange('09:00','10:00'),true);
 for(const start of ['', '10:00','11:00','25:00'])assert.equal(M.validRange(start,'10:00'),false);
 assert.equal(M.minutes('23:59'),1439);assert.equal(M.minutes('12:60'),null);
 assert.deepEqual(M.interval({time:'23:50'}),{start:1430,end:1440});
});
test('overlaps distinguish adjacent appointments and different dates',()=>{
 const a={date:'2026-10-23',time:'09:00',endTime:'10:00'};
 assert.equal(M.overlap(a,{...a,time:'09:30'}),true);
 assert.equal(M.overlap(a,{...a,time:'10:00',endTime:'11:00'}),false);
 assert.equal(M.overlap(a,{...a,date:'2026-10-24'}),false);
});
test('only reminder schedule edits reset notification state',()=>{
 const t={date:'2026-10-23',time:'09:00',reminderMinutes:5,alarmNotified:true,reminderNotified:true,reminderVersion:1};
 assert.equal(M.update(t,{projectId:'p',endTime:'10:00'},2).alarmNotified,true);
 const changed=M.update(t,{time:'09:30'},3);assert.equal(changed.reminderVersion,3);assert.equal(changed.reminderNotified,false);
});
test('preview storage cannot read or overwrite normal data',()=>{
 const data=new Map([['tasks','production']]); const context={window:{},URLSearchParams,location:{search:'?preview=1'},localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
 vm.runInNewContext(fs.readFileSync('natija-storage.js','utf8'),context);
 assert.equal(context.window.NatijaStorage.getItem('tasks'),undefined);
 context.window.NatijaStorage.setItem('tasks','preview');assert.equal(data.get('tasks'),'production');
});
test('all browser scripts and inline JS parse',()=>{
 for(const file of ['natija-model.js','natija-storage.js','natija-v2.js','cloud.js','onboarding.js','sw.js'])new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
 for(const m of fs.readFileSync('index.html','utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/src=|application\/ld\+json/.test(m[1]))new vm.Script(m[2]);
});
