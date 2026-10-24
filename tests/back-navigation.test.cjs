/* Regression: native browser / Android Back must dismiss Edit, not exit Natija. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const dom=new JSDOM(html,{
  url:'https://natija.test/task-calendar-/?preview=1',
  pretendToBeVisual:true,
  runScripts:'outside-only'
});
const w=dom.window;
w.matchMedia=()=>({matches:true,addListener(){},removeListener(){}});
w.Element.prototype.scrollIntoView=function(){};
w.Element.prototype.animate=function(){return {cancel(){}};};
w.HTMLCanvasElement.prototype.getContext=()=>null;
if(typeof w.crypto.randomUUID!=='function'){
  Object.defineProperty(w.crypto,'randomUUID',{value:()=>String(Date.now())+'-'+Math.random()});
}
const context=dom.getInternalVMContext();
function load(name){
  new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name}).runInContext(context);
}
function popstate(){
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('No popstate: browser navigation was not consumed')),1500);
    w.addEventListener('popstate',e=>{clearTimeout(timeout);resolve(e);},{once:true});
  });
}
async function run(){
  try{
    load('natija-storage.js');
    load('natija-model.js');
    const appInline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(m=>!/\bsrc\s*=/.test(m[1])&&!/application\/ld\+json/i.test(m[1]))
      .map(m=>m[2]).find(s=>s.includes('function addTask()'));
    assert.ok(appInline);
    new vm.Script(appInline,{filename:'index.inline.js'}).runInContext(context);
    load('natija-v2.js');
    const date=new Date();
    const dateString=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    w.document.getElementById('taskTitle').value='Edit Navigation Test';
    w.document.getElementById('taskDate').value=dateString;
    w.document.getElementById('taskTime').value='09:00';
    w.addTask();
    const task=JSON.parse(w.localStorage.getItem('natija-preview:tasks'))[0];
    assert.ok(task);

    const modal=w.document.getElementById('editTaskModal');
    const pathBefore=w.location.pathname;
    const baseHistoryLength=w.history.length;
    w.openEditTask(task.id);
    assert.ok(modal.classList.contains('active'),'Edit modal opened');
    assert.equal(w.history.length,baseHistoryLength+1,'Editor gets a same-page history entry');
    assert.match(w.history.state.natijaEditMarker,/^natija-edit-/);
    assert.equal(w.location.pathname,pathBefore,'Opening editor does not navigate away');

    const firstPop=popstate();
    w.history.back();
    await firstPop;
    assert.equal(modal.classList.contains('active'),false,'Android/mouse Back dismisses editor');
    assert.equal(w.location.pathname,pathBefore,'Back remains on Natija');
    assert.equal(w.document.body.classList.contains('task-edit-open'),false);
    assert.equal(JSON.parse(w.localStorage.getItem('natija-preview:tasks'))[0].title,task.title,
      'Back does not modify saved data');

    w.openEditTask(task.id);
    assert.ok(modal.classList.contains('active'),'Editor can reopen');
    const cancelPop=popstate();
    w.closeEditTaskModal();
    assert.equal(modal.classList.contains('active'),false,'Cancel closes instantly');
    await cancelPop;
    assert.equal(w.history.state?.natijaEditMarker,undefined,'Cancel cleans temporary history entry');
    assert.equal(w.location.pathname,pathBefore);

    w.openEditTask(task.id);
    const savePop=popstate();
    w.document.getElementById('editTaskTitle').value='Edited successfully';
    w.saveEditedTask();
    await savePop;
    assert.equal(modal.classList.contains('active'),false,'Save closes editor');
    assert.equal(w.history.state?.natijaEditMarker,undefined,'Save cleans history');
    assert.equal(JSON.parse(w.localStorage.getItem('natija-preview:tasks'))[0].title,'Edited successfully');
    console.log('PASS: edit Back / Cancel / Save all stay inside Natija and preserve data.');
  }finally{
    dom.window.close();
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
