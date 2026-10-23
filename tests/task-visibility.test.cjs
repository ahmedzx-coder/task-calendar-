const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../natija-model.js');
test('completed tasks disappear after their local calendar day, without changing history',()=>{
 const task={id:1,date:'2026-10-23',completed:true,status:'done',projectId:'p',reminderVersion:10};
 const before=JSON.stringify(task);
 assert.equal(M.visibleTask(task,'2026-10-23'),true);
 assert.equal(M.visibleTask(task,'2026-10-24'),false);
 assert.equal(JSON.stringify(task),before);
 assert.deepEqual(M.progress([task], 'p'),{total:1,done:1,percent:100});
});
test('unfinished overdue, today, future, and undated tasks remain available',()=>{
 for(const t of [{date:'2026-10-23',completed:false},{date:'2026-10-24',completed:true},{date:'2026-10-25',status:'done'},{completed:true}])assert.equal(M.visibleTask(t,'2026-10-24'),true);
 assert.equal(M.visibleTask({date:'2026-10-23',status:'done'},'2026-10-24'),false);
});
