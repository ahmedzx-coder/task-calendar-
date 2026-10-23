const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('    function checkAlarms(){'),html.indexOf('    function showAlarmToast('));
function check(task,hour,minute){
 const alarms=[],now=new Date(2026,9,23,hour,minute,30);
 class Clock extends Date { constructor(...args){super(...(args.length?args:[now.getTime()]));} }
 const c={Date:Clock,tasks:[task],formatDate:()=> '2026-10-23',getCurrentMinutes:()=>hour*60+minute,parseHHMMToMinutes:s=>Number(s.slice(0,2))*60+Number(s.slice(3)),window:{NatijaStorage:{setItem:()=>{}}},currentLang:'en',showToast:()=>{},playAlarmSound:()=>{},showAlarmToast:ts=>alarms.push(...ts)};
 vm.runInNewContext(source+';checkAlarms();',c);return alarms;
}
const task=()=>({id:1,date:'2026-10-23',time:'09:00',createdAt:new Date(2026,9,23,8).toISOString()});
test('adding default 09:00 task late in the day never rings immediately',()=>{
 const t=task();t.createdAt=new Date(2026,9,23,18).toISOString();assert.equal(check(t,18,0).length,0);
});
test('task created during its start minute does not ring immediately',()=>{
 const t=task();t.createdAt=new Date(2026,9,23,9,0,10).toISOString();assert.equal(check(t,9,0).length,0);
});
test('future task rings when due once, with limited catchup',()=>{
 const t=task();assert.equal(check(t,8,59).length,0);assert.equal(check(t,9,0).length,1);assert.equal(check(t,9,1).length,0);
 assert.equal(check(task(),9,2).length,1);assert.equal(check(task(),12,0).length,0);
});
test('all background alarm channels reject newly created past starts',()=>{
 for(const file of ['functions/index.js','scripts/send-reminders.js','scripts/send-email-reminders.js','scripts/telegram-reminders.js']){
  const s=fs.readFileSync(file,'utf8');new vm.Script(s);
  const ctx={};vm.runInNewContext(s.slice(s.indexOf('function alarmWasScheduledAhead(')),ctx);
  const clock={set:()=>({toMillis:()=>1000})};
  assert.equal(ctx.alarmWasScheduledAhead({reminderVersion:1500},clock,540),false,file);
  assert.equal(ctx.alarmWasScheduledAhead({reminderVersion:500},clock,540),true,file);
 }
});
