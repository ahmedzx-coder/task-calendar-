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
  const api={minutes,normalize,validRange,interval,overlap,update};
  if(typeof module!=='undefined') module.exports=api;
  else root.NatijaModel=api;
})(typeof window==='undefined' ? globalThis : window);
