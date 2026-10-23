/* Natija first-sign-in guided tour.
 * Progress is stored per Firebase UID in Firestore, with localStorage backup.
 * No demo tasks are created and no notification permission is requested here.
 */
(function () {
  'use strict';

  const VERSION = 1;
  const PREFIX = 'natija:onboarding:v' + VERSION + ':';
  const STEPS = [
    { icon:'👋', target:'[data-view="today"]', title:{ar:'ابدأ من «يومي»',en:'Start with My day'}, body:{ar:'هنا مهام النهارده فقط. المهام في الأيام الأخرى موجودة في «كل المهام».',en:'See today’s tasks here. Tasks on other dates are available under All tasks.'} },
    { icon:'✍️', target:'[data-new-task]', title:{ar:'أضف مهمة واحدة',en:'Add one task'}, body:{ar:'اضغط «+ مهمة»، اكتب اسمها وحدد التاريخ، ثم احفظ. التذكير والتكرار والمشروع تحت «خيارات إضافية».',en:'Select + Task, enter a name and date, then save. Reminders, repeats and projects are under More options.'} },
    { icon:'📅', target:'.n2-nav', title:{ar:'اختار العرض المناسب',en:'Choose a view'}, body:{ar:'«التقويم» لترتيب المواعيد. «كل المهام» لمتابعة ما بدأ وما اكتمل. «المشروعات» لجمع مهام هدف واحد. افتح اسم أي مهمة لتعديلها.',en:'Calendar is for scheduling. All tasks tracks progress. Projects groups tasks for one goal. Open any task name to edit it.'} },
    { icon:'✅', target:'#menuToggleBtn', title:{ar:'الباقي وقت ما تحتاجه',en:'More when you need it'}, body:{ar:'اللغة والإحصائيات ووسائل التذكير في القائمة. تقدر ترجع للجولة دي منها في أي وقت. ابدأ بمهمة واحدة.',en:'Language, statistics and reminder channels are in the menu. Replay this tour there anytime. Start with one task.'} }
  ];

  let active = false;
  let step = 0;
  let accountId = null;
  let previouslyFocused = null;
  let layoutRaf = null;
  let deferredLayout = null;

  const $ = id => document.getElementById(id);
  const language = () => (window.NatijaStorage.getItem('task-planner-lang-v1') === 'en' ? 'en' : 'ar');
  const t = (ar, en) => language() === 'ar' ? ar : en;
  const storeKey = uid => PREFIX + uid;

  function markAsSeen() {
    if (!accountId) return;
    try { window.NatijaStorage.setItem(storeKey(accountId), '1'); } catch (_e) {}
    window.dispatchEvent(new CustomEvent('natija-onboarding-completed', {
      detail: { version: VERSION, uid: accountId }
    }));
  }

  function ensureMarkup() {
    if ($('natijaTour')) return;
    document.body.insertAdjacentHTML('beforeend', [
      '<div id="natijaTour" class="natija-tour" role="dialog" aria-modal="true"',
      ' aria-labelledby="natijaTourTitle" aria-describedby="natijaTourDescription" hidden>',
      ' <div class="natija-tour-veil" aria-hidden="true"></div>',
      ' <div id="natijaTourSpotlight" class="natija-tour-spotlight" aria-hidden="true"></div>',
      ' <section class="natija-tour-dialog" tabindex="-1">',
      '  <div class="natija-tour-intro">',
      '   <span class="natija-tour-brand">NATIJA · GUIDE</span>',
      '   <span id="natijaTourCount" class="natija-tour-count"></span>',
      '  </div>',
      '  <div id="natijaTourProgress" class="natija-tour-progress" aria-hidden="true"></div>',
      '  <div id="natijaTourIcon" class="natija-tour-illustration" aria-hidden="true"></div>',
      '  <h2 id="natijaTourTitle" class="natija-tour-title"></h2>',
      '  <p id="natijaTourDescription" class="natija-tour-description"></p>',
      '  <div class="natija-tour-actions">',
      '   <button id="natijaTourSkip" class="natija-tour-btn textual" type="button"></button>',
      '   <button id="natijaTourBack" class="natija-tour-btn" type="button"></button>',
      '   <button id="natijaTourNext" class="natija-tour-btn primary" type="button"></button>',
      '  </div>',
      ' </section>',
      '</div>'
    ].join(''));
    $('natijaTourSkip').addEventListener('click', () => close(true));
    $('natijaTourBack').addEventListener('click', () => changeStep(-1));
    $('natijaTourNext').addEventListener('click', () => {
      if (step === STEPS.length - 1) close(true);
      else changeStep(1);
    });
    $('natijaTour').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (event.key !== 'Tab') return;
      const controls = [$('natijaTourSkip'), $('natijaTourBack'), $('natijaTourNext')]
        .filter(button => !button.disabled);
      const current = controls.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault(); controls[controls.length - 1].focus();
      } else if (!event.shiftKey && current === controls.length - 1) {
        event.preventDefault(); controls[0].focus();
      }
    });
  }

  function requestLayout() {
    if (!active || layoutRaf != null) return;
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = null;
      positionSpotlight();
    });
  }

  function positionSpotlight() {
    if (!active) return;
    const overlay = $('natijaTour');
    const spotlight = $('natijaTourSpotlight');
    const definition = STEPS[step];
    const element = definition.target ? document.querySelector(definition.target) : null;
    if (!element) {
      overlay.classList.remove('has-target', 'is-top');
      spotlight.style.display = 'none';
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      overlay.classList.remove('has-target', 'is-top');
      spotlight.style.display = 'none';
      return;
    }
    overlay.classList.add('has-target');
    // Keep the card away from the area being highlighted.
    overlay.classList.toggle('is-top', rect.top > innerHeight * .50);
    const pad = 7;
    const left = Math.max(5, rect.left - pad);
    const top = Math.max(5, rect.top - pad);
    const right = Math.min(innerWidth - 5, rect.right + pad);
    const bottom = Math.min(innerHeight - 5, rect.bottom + pad);
    if (bottom <= top || right <= left) {
      overlay.classList.remove('has-target', 'is-top');
      spotlight.style.display = 'none';
      return;
    }
    spotlight.style.cssText = [
      'display:block',
      'left:' + left + 'px',
      'top:' + top + 'px',
      'width:' + (right - left) + 'px',
      'height:' + (bottom - top) + 'px'
    ].join(';');
  }

  function render() {
    if (!active) return;
    ensureMarkup();
    const overlay = $('natijaTour');
    const definition = STEPS[step];
    const lang = language();
    overlay.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    $('natijaTourTitle').textContent = definition.title[lang];
    $('natijaTourDescription').textContent = definition.body[lang];
    $('natijaTourIcon').textContent = definition.icon;
    $('natijaTourCount').textContent = t('خطوة ' + (step + 1) + ' من ' + STEPS.length,
                                        'Step ' + (step + 1) + ' of ' + STEPS.length);
    $('natijaTourProgress').innerHTML = Array.from({ length: STEPS.length }, (_, index) =>
      '<span class="' + (index <= step ? 'active' : '') + '"></span>').join('');
    $('natijaTourSkip').textContent = t('تخطي الشرح', 'Skip tour');
    $('natijaTourBack').textContent = t('السابق', 'Back');
    $('natijaTourBack').disabled = step === 0;
    $('natijaTourNext').textContent = step === STEPS.length - 1
      ? t('ابدأ استخدام نتيجة', 'Start using Natija')
      : step === 0 ? t('يلا نبدأ', 'Start tour') : t('التالي', 'Next');

    const target = definition.target && document.querySelector(definition.target);
    if (target) {
      target.scrollIntoView({
        behavior: 'instant', block: 'center', inline: 'nearest'
      });
    }
    requestLayout();
    // Mobile browser chrome / dynamic height can settle after layout.
    clearTimeout(deferredLayout);
    deferredLayout = setTimeout(requestLayout, 120);
    $('natijaTourNext').focus({ preventScroll: true });
  }

  function changeStep(delta) {
    step = Math.max(0, Math.min(STEPS.length - 1, step + delta));
    render();
  }

  function start() {
    if (active || document.body.classList.contains('auth-locked')) return;
    ensureMarkup();
    if (typeof closeMainMenu === 'function') closeMainMenu();
    const m = $('editTaskModal');
    if (m && m.classList.contains('active')) return;
    previouslyFocused = document.activeElement;
    active = true;
    step = 0;
    $('natijaTour').hidden = false;
    document.body.classList.add('natija-tour-open');
    render();
  }

  function close(mark) {
    if (!active) return;
    active = false;
    clearTimeout(deferredLayout);
    if (layoutRaf != null) cancelAnimationFrame(layoutRaf);
    layoutRaf = null;
    $('natijaTour').hidden = true;
    $('natijaTour').classList.remove('is-top', 'has-target');
    document.body.classList.remove('natija-tour-open');
    if (mark) markAsSeen();
    if (previouslyFocused && previouslyFocused.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
    previouslyFocused = null;
  }

  function maybeStart(uid, isComplete) {
    if (!uid || accountId !== uid) return;
    let locallyComplete = false;
    try { locallyComplete = window.NatijaStorage.getItem(storeKey(uid)) === '1'; } catch (_e) {}
    if (isComplete || locallyComplete) return;
    start();
  }

  window.NatijaTour = {
    identify(uid) {
      if (!uid) { close(false); accountId = null; return; }
      accountId = String(uid);
    },
    maybeStart,
    start,
    dismiss() { close(false); },
    refresh() { if (active) render(); }
  };
  window.startNatijaTourFromMenu = start;
  window.addEventListener('natija-language-changed', () => {
    if (active) render();
  });
  window.addEventListener('scroll', requestLayout, true);
  window.addEventListener('resize', requestLayout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', requestLayout);
    window.visualViewport.addEventListener('scroll', requestLayout);
  }
})();
