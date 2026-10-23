const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../natija-model.js');
const task={id:1,time:'09:15',endTime:'10:45',date:'2026-10-23',reminderMinutes:10,reminderVersion:1,reminderNotified:true,alarmNotified:true};
test('drag preserves duration and resets reminder delivery key',()=>{
 const moved=M.reschedule(task,'2026-10-24',720,99);
 assert.equal(moved.time,'12:00');assert.equal(moved.endTime,'13:30');assert.equal(moved.date,'2026-10-24');assert.equal(moved.reminderVersion,99);assert.equal(moved.alarmNotified,false);
 assert.equal(task.time,'09:15');
});
test('resize changes only duration, preserves start reminder identity',()=>{
 const resized=M.resize(task,660,99);assert.equal(resized.endTime,'11:00');assert.equal(resized.time,task.time);assert.equal(resized.reminderVersion,1);assert.equal(resized.reminderNotified,true);
 assert.throws(()=>M.resize(task,555));assert.throws(()=>M.resize(task,1440));
});
test('drag rejects spillover and preserves untimed legacy end',()=>{
 assert.throws(()=>M.reschedule(task,task.date,1380));assert.throws(()=>M.reschedule(task,task.date,-15));
 const moved=M.reschedule({id:2,date:task.date,time:'',endTime:''},task.date,600);assert.equal(moved.time,'10:00');assert.equal(moved.endTime,'');
});
test('project progress is derived from current completion, including reopening',()=>{
 const tasks=[{projectId:'p',completed:true},{projectId:'p',completed:false},{projectId:'other',completed:true}];
 assert.deepEqual(M.progress(tasks,'p'),{total:2,done:1,percent:50});tasks[0].completed=false;
 assert.equal(M.progress(tasks,'p').percent,0);assert.deepEqual(M.progress(tasks,'missing'),{total:0,done:0,percent:0});
});
