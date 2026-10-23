const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../natija-model.js'),html=fs.readFileSync('index.html','utf8');
class Clock extends Date {constructor(...args){super(...(args.length?args:[2026,9,24,12]));}}
function source(name){const start=html.indexOf('    function '+name+'(');return html.slice(start,html.indexOf('    function ',start+14));}
function context(tasks=[]){
 const el={innerHTML:'لا توجد مهام بزمن محدد لهذا اليوم'};
 return {el,document:{getElementById:()=>el},tasks,selectedDate:new Date('2026-10-23T00:00:00'),Date:Clock,window:{NatijaModel:M},formatDate:d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),currentCategoryFilter:'all',currentSearchQuery:'',currentLang:'en',viewMode:'month',formatDateDisplay:s=>s,parseHHMMToMinutes:M.minutes,categoryIcons:{},esc:s=>String(s)};
}
test('timeline empty message switches between English and Arabic without a runtime error',()=>{
 const c=context();vm.runInNewContext(source('renderTimeline'),c);
 c.renderTimeline();assert.match(c.el.innerHTML,/No timed tasks for this day/);assert.doesNotMatch(c.el.innerHTML,/لا توجد/);
 c.currentLang='ar';c.renderTimeline();assert.match(c.el.innerHTML,/لا توجد مهام بزمن محدد/);
 c.currentLang='en';c.renderTimeline();assert.match(c.el.innerHTML,/No timed tasks/);
});
test('timeline hides completed past tasks but still renders unfinished timed tasks',()=>{
 const c=context([{title:'hidden finished',date:'2026-10-23',time:'09:00',completed:true},{title:'overdue active',date:'2026-10-23',time:'10:00',completed:false}]);
 vm.runInNewContext(source('renderTimeline')+';renderTimeline();',c);
 assert.doesNotMatch(c.el.innerHTML,/hidden finished/);assert.match(c.el.innerHTML,/overdue active/);
});
test('legacy task list applies history filtering in its own scope',()=>{
 const c=context([{title:'hidden finished',date:'2026-10-23',time:'09:00',completed:true}]);
 vm.runInNewContext(source('renderTasks')+';renderTasks();',c);
 assert.match(c.el.innerHTML,/No tasks for/);assert.doesNotMatch(c.el.innerHTML,/hidden finished/);
});
