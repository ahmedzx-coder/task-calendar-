(function (root) {
  'use strict';
  const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null;
  function normalize(task) {
    return {...task, schemaVersion: 2, endTime: task.endTime || '', projectId: task.projectId || '',
      status: task.completed ? 'done' : task.status === 'doing' ? 'doing' : 'todo',
      subtasks: Array.isArray(task.subtasks) ? task.subtasks : []};
  }
  function validRange(start, end) { return !end || (minutes(start) !== null && minutes(end) !== null && minutes(end) > minutes(start)); }
  function interval(task) {
    const start = minutes(task.time);
    return start === null ? null : {start, end: validRange(task.time, task.endTime) && task.endTime ? minutes(task.endTime) : Math.min(1440, start + 30)};
  }
  function overlap(a,b) { const x=interval(a), y=interval(b); return a.date===b.date && x && y && x.start<y.end && y.start<x.end; }
  function update(task, patch, now = Date.now()) {
    const result = normalize({...task,...patch,updatedAt:now});
    if (!validRange(result.time,result.endTime)) throw new Error('Invalid time range');
    if (task.date!==result.date || task.time!==result.time || task.reminderMinutes!==result.reminderMinutes) {
      result.reminderVersion=now; result.alarmNotified=false; result.reminderNotified=false;
    }
    return result;
  }
  const timeString = value => String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  function reschedule(task,date,start,now=Date.now()) {
    const old=interval(task), duration=old?old.end-old.start:30;
    if(!Number.isInteger(start)||start<0||start+duration>1439)throw new Error('Outside day');
    return update(task,{date,time:timeString(start),endTime:task.endTime?timeString(start+duration):''},now);
  }
  function resize(task,end,now=Date.now()) {
    if(!Number.isInteger(end)||end>1439||end<0)throw new Error('Outside day');
    return update(task,{endTime:timeString(end)},now);
  }
  function progress(tasks,projectId){
    const selected=tasks.filter(t=>t.projectId===projectId), done=selected.filter(t=>t.completed).length;
    return {total:selected.length,done,percent:selected.length?Math.round(done/selected.length*100):0};
  }
  function visibleTask(task,today){
    return !((task.completed || task.status==='done') && /^\d{4}-\d{2}-\d{2}$/.test(task.date||'') && task.date<today);
  }
  // Decide which workspace screen should show the task immediately after save.
  // Pure helper: never mutates a task, changes a reminder or writes to storage.
  function savedTaskDestination(task, state) {
    const next = {...state}, today = state.today;
    if (next.view === 'today' && task.date !== today) {
      next.view = 'planner';
      next.date = task.date;
    } else if (next.view === 'planner' && task.date !== next.date) {
      next.date = task.date;
    } else if (next.view === 'projects' && task.projectId !== next.filter) {
      if (task.projectId && (state.projectIds || []).includes(task.projectId)) {
        next.filter = task.projectId;
      } else {
        next.view = 'board';
        next.filter = '';
        next.boardQuery = '';
      }
    } else if (next.view === 'board') {
      // Old search/project filters must not conceal the task just saved.
      if (next.filter && next.filter !== task.projectId) next.filter = '';
      const words = [task.title, ...(task.subtasks || []).map(s => s.title)].join(' ').toLocaleLowerCase();
      if (next.boardQuery && !words.includes(next.boardQuery.trim().toLocaleLowerCase())) next.boardQuery = '';
    }
    return next;
  }
  const api={minutes,normalize,validRange,interval,overlap,update,reschedule,resize,progress,visibleTask,savedTaskDestination};
  if(typeof module!=='undefined') module.exports=api;
  else root.NatijaModel=api;
})(typeof window==='undefined' ? globalThis : window);
