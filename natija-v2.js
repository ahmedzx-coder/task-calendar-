(function () {
  'use strict';
  const M=window.NatijaModel, storage=window.NatijaStorage;
  let projects=JSON.parse(storage.getItem('natija-projects-v2') || '[]');
  let dragged=null;
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
    return `<article class="n2-card" draggable="true" data-drag="${esc(t.id)}"><button data-edit="${esc(t.id)}">${esc(t.title)}</button>${p&&view!=='projects'?`<span class="n2-project-tag">${esc(p.title)}</span>`:''}<small>${esc(t.date)} ${esc(t.time||'')}${t.endTime?' – '+esc(t.endTime):''}</small>
      <label>${tr('الحالة','Status')}<select data-status="${esc(t.id)}">${['todo','doing','done'].map((s,i)=>`<option value="${s}" ${M.normalize(t).status===s?'selected':''}>${[tr('للعمل','To do'),tr('جارٍ التنفيذ','In progress'),tr('مكتمل','Done')][i]}</option>`).join('')}</select></label>
      ${(t.subtasks||[]).map(s=>`<label><input type="checkbox" data-task="${esc(t.id)}" data-sub="${esc(s.id)}" ${s.completed?'checked':''}>${esc(s.title)}</label>`).join('')}</article>`;
  }
  function projectPage(){
    const p=projects.find(p=>p.id===filter);
    if(!p)return `<p class="n2-hint">${tr('مساحة مستقلة لكل مشروع. افتح مشروعًا لمتابعة المهام والتقدم.','A dedicated space for each project. Open one to review its tasks and progress.')}</p><div class="n2-project-list">${projects.map(p=>{const progress=M.progress(tasks,p.id);return `<button class="n2-project-summary" data-project="${esc(p.id)}"><span class="n2-project-icon" aria-hidden="true">▦</span><strong>${esc(p.title)}</strong><span class="n2-project-excerpt">${esc(p.description||tr('ابدأ بربط مهامك بهذا المشروع','Bring related tasks together'))}</span><span>${p.dueDate?esc(p.dueDate)+' · ':''}${progress.done}/${progress.total} · ${progress.percent}%</span><progress value="${progress.percent}" max="100" aria-label="${esc(p.title)}"></progress></button>`;}).join('')||`<p>${tr('ابدأ بإنشاء مشروع جديد، ثم اربط المهام به.','Create a project, then assign tasks to it.')}</p>`}</div>`;
    const progress=M.progress(tasks,p.id), overdue=p.dueDate&&p.dueDate<formatDate(new Date())&&progress.done<progress.total;
    return `<button class="n2-back" data-projects-back>${tr('← كل المشروعات','← All projects')}</button><section class="n2-project-detail"><h3>${esc(p.title)}</h3><p class="n2-description">${esc(p.description||tr('أضف وصفًا من تعديل المشروع.','Add a description using Edit project.'))}</p><p>${tr('موعد التسليم','Due date')}: ${esc(p.dueDate||'—')} ${overdue?tr('· متأخر','· Overdue'):''}</p><label>${tr('الإنجاز','Progress')}: ${progress.done}/${progress.total} (${progress.percent}%)<progress max="100" value="${progress.percent}"></progress></label></section>${board(tasks.filter(t=>t.projectId===p.id))}`;
  }
  function draw(){
    host.parentElement.classList.toggle('n2-project-mode',view==='projects');
    const scrollTop=host.querySelector('.n2-hours')?.scrollTop||0;
    if(filter&&!projects.some(p=>p.id===filter))filter='';
    const list=tasks.filter(t=>view==='planner'||!filter||t.projectId===filter), date=formatDate(selectedDate);
    host.innerHTML=`<h2>Natija 2.0</h2><p>${tr('خطّط يومك، وحرّك مشروعاتك للأمام','Plan your day. Move your projects forward.')}</p>
      ${window.NatijaPreview?`<p class="n2-preview">${tr('معاينة محلية منفصلة — لا مزامنة ولا تنبيهات خلفية','Isolated local preview — no sync or background notifications')}</p>`:''}
      <nav class="n2-nav" aria-label="${tr('عروض التنظيم','Workspace views')}"><button data-view="planner" aria-pressed="${view==='planner'}">${tr('مخطط اليوم','Day planner')}</button><button data-view="board" aria-pressed="${view==='board'}">${tr('لوحة المهام','Task board')}</button><button data-view="projects" aria-pressed="${view==='projects'}">${tr('المشروعات','Projects')}</button></nav>
      <div class="n2-toolbar n2-actions">${view==='projects'?`<button data-new-project>${tr('+ مشروع جديد','+ New project')}</button>${filter?`<button data-rename>${tr('تعديل المشروع','Edit project')}</button><button data-new-task>${tr('+ مهمة للمشروع','+ Project task')}</button>`:''}`:`${view==='board'?`<label>${tr('تصفية بالمشروع','Filter by project')}<select id="n2Filter">${options(filter,true)}</select></label>`:''}<button data-new-task>${tr('+ مهمة','+ Task')}</button>`}</div>
      ${projectEditor!==null?`<form id="n2ProjectForm" class="n2-toolbar"><label>${tr('اسم المشروع','Project name')}<input id="n2ProjectName" required maxlength="120" value="${esc(projectEditor.title||'')}"></label><label>${tr('وصف المشروع','Description')}<textarea id="n2ProjectDescription" maxlength="2000">${esc(projectEditor.description||'')}</textarea></label><label>${tr('موعد التسليم','Due date')}<input type="date" id="n2ProjectDue" value="${esc(projectEditor.dueDate||'')}"></label><button type="submit">${tr('حفظ المشروع','Save project')}</button><button type="button" data-cancel-project>${tr('إلغاء','Cancel')}</button></form>`:''}
      ${view==='planner'?planner(list,date):view==='projects'?projectPage():board(list)}`;
    const hours=host.querySelector('.n2-hours');if(hours)hours.scrollTop=scrollTop;
  }
  function planner(list,date){
    const day=list.filter(t=>t.date===date);
    return `<div class="n2-toolbar"><button data-day="-1" aria-label="${tr('اليوم السابق','Previous day')}">−</button><label>${tr('اليوم','Day')}<input type="date" id="n2Date" value="${date}"></label><button data-day="1" aria-label="${tr('اليوم التالي','Next day')}">+</button></div>
      <p class="n2-hint">${tr('اسحب المهمة لساعة كاملة أو اسحب ↕ لتغيير النهاية. من ٤ لـ٥ مباشرة، بدون أرباع ساعة. اضغط للتعديل. اضغط على الساعة لإضافة مهمة. المهام القديمة دون نهاية تظهر لمدة ٣٠ دقيقة تقديرية.','Drag a task or its ↕ end handle to a whole hour. From 4 to 5 directly, with no quarter-hour steps. Click to edit. Select an hour to add a task. Legacy tasks without an end appear with an estimated 30-minute duration.')}</p>
      <div>${day.filter(t=>!M.interval(t)).map(card).join('')}</div><div class="n2-hours">${Array.from({length:24},(_,h)=>`<div class="n2-hour" data-drop-hour="${h}"><button data-hour="${h}" aria-label="${tr('أضف مهمة عند','Add task at')} ${h}:00">${String(h).padStart(2,'0')}:00</button><div>${day.filter(t=>M.interval(t)&&Math.floor(M.interval(t).start/60)===h).sort((a,b)=>a.time.localeCompare(b.time)).map(t=>`<div class="n2-event-wrap"><button draggable="true" data-drag="${esc(t.id)}" class="n2-event ${t.completed?'n2-muted':''}" data-edit="${esc(t.id)}">${esc(t.time)}–${esc(t.endTime||'≈30m')} · ${esc(t.title)} ${day.some(o=>o.id!==t.id&&!o.completed&&!t.completed&&M.overlap(t,o))?tr('⚠ تعارض','⚠ Overlap'):''}<small> · ${M.interval(t).end-M.interval(t).start} ${tr('دقيقة','min')}</small></button><button class="n2-resize" draggable="true" data-resize="${esc(t.id)}" data-edit="${esc(t.id)}" aria-label="${tr('تغيير نهاية المهمة','Change task end')}" title="${tr('اسحب إلى وقت النهاية أو اضغط للتعديل','Drag to end time or click to edit')}">↕</button></div>`).join('')}</div></div>`).join('')}</div>`;
  }
  function board(list){return `<p>${tr('اسحب المهمة بين الأعمدة، أو استخدم قائمة الحالة. كل التواريخ.','Drag a task between columns, or use its status menu. All dates.')}</p><div class="n2-board">${['todo','doing','done'].map((s,i)=>{const items=list.filter(t=>M.normalize(t).status===s);return `<section class="n2-column" data-drop-status="${s}"><h3>${[tr('للعمل','To do'),tr('جارٍ التنفيذ','In progress'),tr('مكتمل','Done')][i]} (${items.length})</h3>${items.map(card).join('')||`<p class="n2-empty">${tr('لا توجد مهام','No tasks')}</p>`}</section>`;}).join('')}</div>`;}
  host.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.project){filter=b.dataset.project;view='projects';draw();}
    if(b.dataset.view){view=b.dataset.view;filter='';projectEditor=null;draw();}
    if(b.hasAttribute('data-projects-back')){filter='';projectEditor=null;draw();}
    if(b.hasAttribute('data-edit'))openEditTask(b.dataset.edit);
    if(b.hasAttribute('data-new-project')||b.hasAttribute('data-rename')){
      const p=projects.find(p=>p.id===filter), rename=b.hasAttribute('data-rename');
      projectEditor=rename?{...p}:{};draw();document.getElementById('n2ProjectName').focus();
    }
    if(b.hasAttribute('data-cancel-project')){projectEditor=null;draw();}
    if(b.dataset.day){const d=new Date(selectedDate);d.setDate(d.getDate()+Number(b.dataset.day));selectDate(d);}
    if(b.hasAttribute('data-hour')||b.hasAttribute('data-new-task')){
      if(view==='projects'){view='planner';draw();}
      document.getElementById('taskDate').value=formatDate(selectedDate);
      if(b.hasAttribute('data-hour'))document.getElementById('taskTime').value=String(b.dataset.hour).padStart(2,'0')+':00';
      document.getElementById('taskProject').value=filter;document.getElementById('taskTitle').focus();
    }
  });
  host.addEventListener('submit',e=>{
    if(e.target.id!=='n2ProjectForm')return;e.preventDefault();
    const title=document.getElementById('n2ProjectName').value.trim();if(!title)return;
    const description=document.getElementById('n2ProjectDescription').value.trim(),dueDate=document.getElementById('n2ProjectDue').value;
    const p=projects.find(p=>p.id===projectEditor.id);
    if(p){p.title=title;p.description=description;p.dueDate=dueDate;p.updatedAt=Date.now();}else{const p={id:crypto.randomUUID(),title,description,dueDate,updatedAt:Date.now()};projects.push(p);filter=p.id;}
    projectEditor=null;saveTasks();refreshProjects();
  });
  host.addEventListener('change',e=>{
    const el=e.target;
    if(el.id==='n2Filter'){filter=el.value;draw();}
    if(el.id==='n2Date'&&el.value)selectDate(new Date(el.value+'T00:00:00'));
    if(el.dataset.status){const t=tasks.find(t=>String(t.id)===el.dataset.status);if(t)status(t,el.value);}
    if(el.dataset.sub){const t=tasks.find(t=>String(t.id)===el.dataset.task);const s=t&&t.subtasks.find(s=>s.id===el.dataset.sub);if(s){s.completed=el.checked;t.updatedAt=Date.now();saveTasks();}}
  });
  function clearDrag(){dragged=null;host.querySelectorAll('.n2-drop-active').forEach(el=>el.classList.remove('n2-drop-active'));}
  host.addEventListener('dragstart',e=>{
    const el=e.target.closest('[data-drag],[data-resize]');if(!el)return;
    dragged={id:el.dataset.drag||el.dataset.resize,resize:el.hasAttribute('data-resize')};
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragged.id);
  });
  host.addEventListener('dragover',e=>{
    const target=e.target.closest('[data-drop-status],[data-drop-hour]');
    if(!dragged||!target||(dragged.resize&&target.hasAttribute('data-drop-status')))return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    host.querySelectorAll('.n2-drop-active').forEach(el=>el.classList.remove('n2-drop-active'));
    target.classList.add('n2-drop-active');
  });
  host.addEventListener('dragend',clearDrag);
  host.addEventListener('drop',e=>{
    const target=e.target.closest('[data-drop-status],[data-drop-hour]');if(!dragged||!target)return;
    e.preventDefault();const action=dragged;clearDrag();
    const task=tasks.find(t=>String(t.id)===action.id);if(!task)return;
    if(target.dataset.dropStatus){if(!action.resize)status(task,target.dataset.dropStatus);return;}
    const minute=Number(target.dataset.dropHour)*60;
    try{
      const next=action.resize?M.resize(task,minute):M.reschedule(task,formatDate(selectedDate),minute);
      Object.assign(task,next);saveTasks();showToast(tr('تم تحديث الموعد','Schedule updated'),'success');
    }catch(error){showToast(tr('اختار نهاية بعد البداية، داخل نفس اليوم','Choose an end after the start, within the same day'),'error');}
  });
  window.addEventListener('natija-language-changed',()=>{
    const drafts=['task','editTask'].map(prefix=>{const el=document.getElementById(prefix+'EndTime');return el?{prefix,endTime:el.value,projectId:document.getElementById(prefix+'Project').value,subtasks:document.getElementById(prefix+'Subtasks').value.split('\n').map(title=>({title}))}:null;});
    draw();drafts.filter(Boolean).forEach(d=>fields(d.prefix,d));
  });
  fields('task');draw();
})();
