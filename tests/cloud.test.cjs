const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('cloud.js','utf8');
function harness(){
 const writes=[],timers=[];
 const ctx={currentUser:{uid:'alice'},saveTimer:null,firebase:{firestore:{FieldValue:{serverTimestamp:()=>123}}},getLocalData:()=>({projects:[{id:'p',title:'Project'}]}),setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},console};
 ctx.userDoc=()=>{const uid=ctx.currentUser.uid;return {set:(payload,options)=>{writes.push({uid,payload,options});return Promise.resolve();}};};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function pushToCloud('),source.indexOf('  function onLocalSave(')),ctx);
 return {ctx,writes,timers};
}
test('cloud saves projects and additive task fields with merge',()=>{
 const {ctx,writes}=harness();const tasks=[{id:1,time:'09:00',endTime:'10:00',subtasks:[],projectId:'p'}];
 ctx.pushToCloud(tasks,[],true);assert.equal(writes[0].payload.projects[0].id,'p');assert.equal(writes[0].payload.tasks[0].endTime,'10:00');assert.equal(writes[0].options.merge,true);
});
test('debounced write cannot leak into a switched account',()=>{
 const {ctx,writes,timers}=harness();ctx.pushToCloud([{id:1}],[],false);ctx.currentUser={uid:'bob'};timers[0]();assert.equal(writes.length,0);
});
test('signed-out delayed write is cancelled',()=>{
 const {ctx,writes,timers}=harness();ctx.pushToCloud([{id:1}],[],false);ctx.currentUser=null;timers[0]();assert.equal(writes.length,0);
});
