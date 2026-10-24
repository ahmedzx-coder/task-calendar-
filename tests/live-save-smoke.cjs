/* Smoke regression: saving tasks and projects updates the UI immediately. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(index, {
  url: 'https://natija.test/task-calendar-/?preview=1',
  pretendToBeVisual: true,
  runScripts: 'outside-only'
});
const w = dom.window;
w.matchMedia = () => ({matches:true,addListener(){},removeListener(){}});
w.Element.prototype.scrollIntoView = function(){};
w.Element.prototype.animate = function(){return {cancel(){}};};
w.HTMLCanvasElement.prototype.getContext = () => null;
if (typeof w.crypto.randomUUID !== 'function') {
  Object.defineProperty(w.crypto,'randomUUID',{value:()=>String(Date.now())+'-'+Math.random()});
}
const context = dom.getInternalVMContext();
const run = (source, filename) => new vm.Script(source, {filename}).runInContext(context);
const loadFile = name => run(fs.readFileSync(path.join(root, name), 'utf8'), name);
const appInline = [...index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && !/application\/ld\+json/i.test(match[1]))
  .map(match => match[2]).find(script => script.includes('function addTask()'));
assert.ok(appInline,'Main application script found');

try {
  loadFile('natija-storage.js');
  loadFile('natija-model.js');
  run(appInline, 'index.inline.js');
  loadFile('natija-v2.js');

  const host = w.document.getElementById('natijaWorkspace');
  assert.ok(host,'V2 workspace mounted');

  // Regression for My Day: show the original live dashboard immediately,
  // not hidden below the V2 cards or outside the selected view.
  const sectionIds=['statsBoxTitle','todayTasksList','tasksList','timelineList'];
  function checkMyDaySections() {
    const dashboard=host.querySelector(':scope > .sidebar.n2-home-widgets');
    assert.ok(dashboard,'Dashboard sidebar must be inside My Day workspace');
    for(const id of sectionIds){
      const element=dashboard.querySelector('#'+id);
      assert.ok(element,id+' must be visible in the My Day dashboard');
      assert.equal(w.document.querySelectorAll('#'+id).length,1,id+' should not be duplicated');
    }
    const dayCards=host.querySelector('.n2-my-day');
    assert.ok(dayCards,'My Day cards should still be present');
    assert.equal(dashboard.nextElementSibling,dayCards,'Stats, tasks, and timeline should be before the daily cards');
  }
  checkMyDaySections();
  // Navigation must reattach the *same* live widgets, not recreate copies.
  host.querySelector('[data-view="board"]').click();
  host.querySelector('[data-view="today"]').click();
  checkMyDaySections();

  // Adding a task for tomorrow while My Day is selected should immediately
  // navigate to its scheduled day rather than appearing to fail.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate()+1);
  const date = [
    tomorrow.getFullYear(),
    String(tomorrow.getMonth()+1).padStart(2,'0'),
    String(tomorrow.getDate()).padStart(2,'0')
  ].join('-');
  w.document.getElementById('taskTitle').value='Live Save Task';
  w.document.getElementById('taskDate').value=date;
  w.document.getElementById('taskTime').value='09:00';
  w.addTask();

  const saved = JSON.parse(w.localStorage.getItem('natija-preview:tasks')||'[]');
  assert.equal(saved.length,1,'Task stored immediately');
  assert.equal(saved[0].date,date);
  assert.match(host.textContent,/Live Save Task/,'Task shown immediately without reload');
  assert.equal(host.querySelector('[data-view="planner"]')?.getAttribute('aria-pressed'),'true',
    'App navigates to saved task date');

  // Project creation should show a project card/heading instantly too.
  host.querySelector('[data-view="projects"]').click();
  host.querySelector('[data-new-project]').click();
  const projectForm = w.document.getElementById('n2ProjectForm');
  assert.ok(projectForm);
  w.document.getElementById('n2ProjectName').value='Live Save Project';
  projectForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const projects = JSON.parse(w.localStorage.getItem('natija-preview:natija-projects-v2')||'[]');
  assert.equal(projects.length,1,'Project stored');
  assert.match(host.textContent,/Live Save Project/,'Project displayed without reload');

  console.log('PASS: saving a task and a project updates Natija immediately.');
} finally {
  dom.window.close();
}
