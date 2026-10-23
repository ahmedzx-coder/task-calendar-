// Runs the actual scheduled function with in-memory Firestore/FCM/time doubles.
// No network, credentials, installed Firebase packages or real deliveries.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../natija-model.js');
async function run(data,hour,minute){
 const sent=[],writes=[];let job;
 const doc={data:()=>data,ref:{set:async value=>{writes.push(value);Object.assign(data,value);}}};
 const db={collection:()=>({get:async()=>({forEach:fn=>fn(doc)})})};
 const modules={
  'firebase-functions/v2/scheduler':{onSchedule:(_,fn)=>{job=fn;}},
  'firebase-admin/app':{initializeApp:()=>{}},
  'firebase-admin/firestore':{getFirestore:()=>db,FieldValue:{arrayRemove:(...tokens)=>tokens}},
  'firebase-admin/messaging':{getMessaging:()=>({sendEachForMulticast:async message=>{sent.push(message);return {responses:[{success:true}]};}})},
  luxon:{DateTime:{now:()=>({setZone:()=>({hour,minute,toFormat:()=> '2026-10-23',set:({hour,minute})=>({toMillis:()=>Date.UTC(2026,9,23,hour,minute)})})})}}
 };
 vm.runInNewContext(fs.readFileSync('functions/index.js','utf8'),{exports:{},require:name=>{if(!modules[name])throw Error(name);return modules[name];},console});
 await job();return {sent,writes};
}
const fixture=()=>({fcmTokens:['fake-token'],tz:'Africa/Cairo',lang:'ar',tasks:[{id:1,title:'Test',date:'2026-10-23',time:'10:00',endTime:'11:00',reminderMinutes:10,projectId:'p',subtasks:[],completed:false}]});
test('actual worker sends due reminder once, ignores project fields',async()=>{
 const data=fixture();assert.equal((await run(data,9,50)).sent.length,1);assert.equal((await run(data,9,51)).sent.length,0);
 assert.equal((await run(data,10,0)).sent.length,1);assert.equal((await run(data,10,1)).sent.length,0);
});
test('drag rescheduling delivers at new time, not original time',async()=>{
 const data=fixture();data.tasks[0]=M.reschedule(data.tasks[0],'2026-10-23',720,50);
 assert.equal((await run(data,10,0)).sent.length,0);assert.equal((await run(data,11,50)).sent.length,1);
 assert.ok(data.pushed['2026-10-23_1_50_rem']);
});
test('done Kanban tasks and future dates produce no delivery',async()=>{
 const data=fixture();data.tasks[0].completed=true;assert.equal((await run(data,10,0)).sent.length,0);
 data.tasks[0].completed=false;data.tasks[0].date='2026-10-24';assert.equal((await run(data,10,0)).sent.length,0);
});
test('new past-time task does not produce a catchup alarm',async()=>{
 const data=fixture();data.tasks[0].createdAt='2026-10-23T10:01:00Z';
 assert.equal((await run(data,10,2)).sent.length,0);
});
test('rescheduling to the past does not produce an alarm',async()=>{
 const data=fixture();data.tasks[0].reminderVersion=Date.UTC(2026,9,23,10,1);
 assert.equal((await run(data,10,2)).sent.length,0);
});
