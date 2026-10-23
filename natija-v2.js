(function () {
  'use strict';
  const M=window.NatijaModel, storage=window.NatijaStorage;
  let projects=JSON.parse(storage.getItem('natija-projects-v2') || '[]');
  let filter='', view='planner', projectEditor=null;
  const tr=(ar,en)=>currentLang==='ar'?ar:en;
  const host=document.createElement('section'); host.className='n2'; host.id='natijaWorkspace';
  document.querySelector('.calendar-grid').closest('section').after(host);
  const normalize=()=>{ tasks=tasks.map(M.normalize); completedTasks=completedTasks.map(c=>M.normalize({...c,...tasks.find(t=>t.id===c.id)})); };
  normalize(); // Additive and deterministic: no timestamp or reminder state is changed.
  function options(value,all=false) {
    return `<option value="">${tr(all?'كل المشروعات':'بدون مشروع',all?'All projects':'No project')}</option>`+projects.map(p=>`<option value="${esc(p.id)}" ${p.id===value?'selected':''}>${esc(p.title)}</option>`).join('');
  }
  function field(id,label,html) {return `<label class="n2-field" for="${id}"><span>${label}</span>${html}</label>`;}
  function refreshProjects(){['task','editTask'].forEach(prefix=>{const el=document.getElementById(prefix+'Project');if(el){const value=el.value;el.innerHTML=options(value);}});}
  ['task','editTask'].forEach(prefix=>{
    const anchor=document.getElementById(prefix+'Notes');
    const wrapper=document.createElement('div'); wrapper.id=prefix+'V2';
    anchor.after(wrapper);
  });
  function fields(prefix,task={}) {
    document.getElementById(prefix+'V2').innerHTML=
      field(prefix+'EndTime',tr('وقت النهاية (اختياري، نفس اليوم)','End time (optional, same day)'),`<input type="time" id="${prefix}EndTime" value="${esc(task.endTime||'')}">`)+
      field(prefix+'Project',tr('المشروع','Project'),`<select id="${prefix}Project">${options(task.projectId||'')}</select>`)+
      field(prefix+'Subtasks',tr('مهام فرعية — سطر لكل مهمة','Subtasks — one per line'),`<textarea id="${prefix}Subtasks">${esc((task.subtasks||[]).map(s=>s.title).join('\n'))}</textarea>`);
  }
  function values(prefix,task={}) {
    const endTime=document.getElementById(prefix+'EndTime').value;
    const start=document.getElementById(prefix+'Time').value;
    if(!M.validRange(start,endTime)){showToast(tr('وقت النهاية لازم يكون بعد البداية في نفس اليوم','End time must be after start on the same day'),'error');return null;}
    const old=[...(task.subtasks||[])];
    const subtasks=document.getElementById(prefix+'Subtasks').value.split('\n').map(s=>s.trim()).filter(Boolean).map(title=>{
      const i=old.findIndex(s=>s.title===title);
      return i<0?{id:crypto.randomUUID(),title,completed:false}:old.splice(i,1)[0];
    });
    return {endTime,projectId:document.getElementById(prefix+'Project').value,subtasks};
  }
  const oldOpen=openEditTask;
  openEditTask=function(id){const t=tasks.find(t=>String(t.id)===String(id));if(t)fields('editTask',t);oldOpen(id);};
  const oldAdd=addTask;
  addTask=function(){const extra=values('task');if(!extra)return;
    const before=new Set(tasks.map(t=>t.id)); oldAdd();
    const added=tasks.filter(t=>!before.has(t.id)); if(!added.length)return;
    added.forEach(t=>Object.assign(t,M.normalize({...t,...extra,subtasks:extra.subtasks.map(s=>({...s})),updatedAt:Date.now()})));
    saveTasks(); fields('task');
  };
  const oldEdit=saveEditedTask;
  saveEditedTask=function(){const t=tasks.find(t=>t.id===editingTaskId);if(!t)return;const extra=values('editTask',t);if(!extra)return;
    const id=t.id;oldEdit();if(editingTaskId!==null)return;
    Object.assign(tasks.find(t=>t.id===id),extra);const done=completedTasks.find(t=>t.id===id);if(done)Object.assign(done,extra);saveTasks();
  };
  const oldSave=saveTasks;
  saveTasks=function(render=true){normalize();storage.setItem('natija-projects-v2',JSON.stringify(projects));oldSave(render);if(render)draw();};
  const oldRender=renderTasks;
  renderTasks=function(){oldRender();draw();};
  const bridge=window.AppBridge, oldGet=bridge.getData, oldRemote=bridge.applyRemote;
  bridge.getData=function(){return {...oldGet(),projects};};
  bridge.applyRemote=function(t,c,p){projects=Array.isArray(p)?p:[];storage.setItem('natija-projects-v2',JSON.stringify(projects));oldRemote((t||[]).map(M.normalize),(c||[]).map(M.normalize));refreshProjects();draw();};
  function status(t,value){
    const now=Date.now();t.status=value;t.completed=value==='done';t.updatedAt=now;
    completedTasks=completedTasks.filter(c=>c.id!==t.id);
    if(t.completed)completedTasks.push({...t,completedAt:new Date(now).toISOString()});
    saveTasks();
  }
  function card(t) {
    const p=projects.find(p=>p.id===t.projectId);
    return `<article class="n2-card"><button data-edit="${esc(t.id)}">${esc(t.title)}</button><small>${esc(p?p.title:tr('بدون مشروع','No project'))} · ${esc(t.date)} ${esc(t.time||'')}${t.endTime?' – '+esc(t.endTime):''}</small>
      <label>${tr('الحالة','Status')}<select data-status="${esc(t.id)}">${['todo','doing','done'].map((s,i)=>`<option value="${s}" ${M.normalize(t).status===s?'selected':''}>${[tr('للعمل','To do'),tr('جارٍ التنفيذ','In progress'),tr('مكتمل','Done')][i]}</option>`).join('')}</select></label>
      ${(t.subtasks||[]).map(s=>`<label><input type="checkbox" data-task="${esc(t.id)}" data-sub="${esc(s.id)}" ${s.completed?'checked':''}>${esc(s.title)}</label>`).join('')}</article>`;
  }
  function draw(){
    if(filter&&!projects.some(p=>p.id===filter))filter='';
    const list=tasks.filter(t=>!filter||t.projectId===filter), date=formatDate(selectedDate);
    host.innerHTML=`<h2>Natija 2.0</h2><p>${tr('خطّط يومك، وحرّك مشروعاتك للأمام','Plan your day. Move your projects forward.')}</p>
      ${window.NatijaPreview?`<p class="n2-preview">${tr('معاينة محلية منفصلة — لا مزامنة ولا تنبيهات خلفية','Isolated local preview — no sync or background notifications')}</p>`:''}
      <div class="n2-toolbar"><button data-view="planner" aria-pressed="${view==='planner'}">${tr('مخطط اليوم','Day planner')}</button><button data-view="board" aria-pressed="${view==='board'}">${tr('لوحة المشروعات','Project board')}</button>
      <label>${tr('المشروع','Project')}<select id="n2Filter">${options(filter,true)}</select></label><button data-new-project>${tr('+ مشروع جديد','+ New project')}</button>${filter?`<button data-rename>${tr('تسمية المشروع','Rename project')}</button>`:''}
      <button data-new-task>${tr('+ مهمة','+ Task')}</button></div>
      ${projectEditor!==null?`<form id="n2ProjectForm" class="n2-toolbar"><label>${tr('اسم المشروع','Project name')}<input id="n2ProjectName" required maxlength="120" value="${esc(projectEditor.title||'')}"></label><button type="submit">${tr('حفظ المشروع','Save project')}</button><button type="button" data-cancel-project>${tr('إلغاء','Cancel')}</button></form>`:''}
      ${view==='planner'?planner(list,date):board(list)}`;
  }
  function planner(list,date){
    const day=list.filter(t=>t.date===date);
    return `<div class="n2-toolbar"><button data-day="-1" aria-label="${tr('اليوم السابق','Previous day')}">−</button><label>${tr('اليوم','Day')}<input type="date" id="n2Date" value="${date}"></label><button data-day="1" aria-label="${tr('اليوم التالي','Next day')}">+</button></div>
      <p>${tr('اضغط على الساعة لإضافة مهمة. المهام القديمة دون نهاية تظهر لمدة ٣٠ دقيقة تقديرية.','Select an hour to add a task. Legacy tasks without an end appear with an estimated 30-minute duration.')}</p>
      <div>${day.filter(t=>!M.interval(t)).map(card).join('')}</div><div class="n2-hours">${Array.from({length:24},(_,h)=>`<div class="n2-hour"><button data-hour="${h}" aria-label="${tr('أضف مهمة عند','Add task at')} ${h}:00">${String(h).padStart(2,'0')}:00</button><div>${day.filter(t=>M.interval(t)&&Math.floor(M.interval(t).start/60)===h).sort((a,b)=>a.time.localeCompare(b.time)).map(t=>`<button class="n2-event ${t.completed?'n2-muted':''}" data-edit="${esc(t.id)}">${esc(t.time)}–${esc(t.endTime||'≈30m')} · ${esc(t.title)} ${day.some(o=>o.id!==t.id&&!o.completed&&!t.completed&&M.overlap(t,o))?tr('⚠ تعارض','⚠ Overlap'):''}<small> · ${M.interval(t).end-M.interval(t).start} ${tr('دقيقة','min')}</small></button>`).join('')}</div></div>`).join('')}</div>`;
  }
  function board(list){return `<p>${tr('كل التواريخ · تغيير الحالة من القائمة يحفظها في كل العروض','All dates · Changing status updates every view')}</p><div class="n2-board">${['todo','doing','done'].map((s,i)=>{const items=list.filter(t=>M.normalize(t).status===s);return `<section class="n2-column"><h3>${[tr('للعمل','To do'),tr('جارٍ التنفيذ','In progress'),tr('مكتمل','Done')][i]} (${items.length})</h3>${items.map(card).join('')||`<p class="n2-empty">${tr('لا توجد مهام','No tasks')}</p>`}</section>`;}).join('')}</div>`;}
  host.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.view){view=b.dataset.view;draw();}
    if(b.hasAttribute('data-edit'))openEditTask(b.dataset.edit);
    if(b.hasAttribute('data-new-project')||b.hasAttribute('data-rename')){
      const p=projects.find(p=>p.id===filter), rename=b.hasAttribute('data-rename');
      projectEditor=rename?{...p}:{};draw();document.getElementById('n2ProjectName').focus();
    }
    if(b.hasAttribute('data-cancel-project')){projectEditor=null;draw();}
    if(b.dataset.day){const d=new Date(selectedDate);d.setDate(d.getDate()+Number(b.dataset.day));selectDate(d);}
    if(b.hasAttribute('data-hour')||b.hasAttribute('data-new-task')){
      document.getElementById('taskDate').value=formatDate(selectedDate);
      if(b.hasAttribute('data-hour'))document.getElementById('taskTime').value=String(b.dataset.hour).padStart(2,'0')+':00';
      document.getElementById('taskProject').value=filter;document.getElementById('taskTitle').focus();
    }
  });
  host.addEventListener('submit',e=>{
    if(e.target.id!=='n2ProjectForm')return;e.preventDefault();
    const title=document.getElementById('n2ProjectName').value.trim();if(!title)return;
    const p=projects.find(p=>p.id===projectEditor.id);
    if(p){p.title=title;p.updatedAt=Date.now();}else{const p={id:crypto.randomUUID(),title,updatedAt:Date.now()};projects.push(p);filter=p.id;}
    projectEditor=null;saveTasks();refreshProjects();
  });
  host.addEventListener('change',e=>{
    const el=e.target;
    if(el.id==='n2Filter'){filter=el.value;draw();}
    if(el.id==='n2Date'&&el.value)selectDate(new Date(el.value+'T00:00:00'));
    if(el.dataset.status){const t=tasks.find(t=>String(t.id)===el.dataset.status);if(t)status(t,el.value);}
    if(el.dataset.sub){const t=tasks.find(t=>String(t.id)===el.dataset.task);const s=t&&t.subtasks.find(s=>s.id===el.dataset.sub);if(s){s.completed=el.checked;t.updatedAt=Date.now();saveTasks();}}
  });
  window.addEventListener('natija-language-changed',()=>{draw();fields('task');if(editingTaskId!==null){const t=tasks.find(t=>t.id===editingTaskId);if(t)fields('editTask',t);}});
  fields('task');draw();
})();
