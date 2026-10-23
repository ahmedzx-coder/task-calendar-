# Natija 2.0 — experimental web branch

Branch: `experimental/natija-2-web`, based on `main`. No Android files, Firebase rules, reminder backend, Pages settings or production deployment are changed.

## Included

- Daily 24-hour planner with editable start/end times, duration and overlap warnings. Click an hour to populate the existing add form; click an event to edit it.
- Projects (create/rename/filter/assign), three Kanban states and checkable subtasks. The same task appears in the original calendar, planner and board.
- Arabic/English labels, existing direction and theme controls, native keyboard-accessible forms.
- `?preview=1` isolates local storage and disables Firebase initialization and service-worker registration. `preview.html` opens this mode. It does not exercise cloud sync or real background delivery.

## Data and compatibility

`natija-model.js` normalizes tasks without changing IDs, dates, reminder state, timestamps or unknown fields. New fields: `schemaVersion: 2`, `endTime`, `projectId`, `status`, `subtasks`. `time` remains the authoritative start time used by all existing reminder workers; `completed` remains authoritative for completion. Old tasks without an end retain an empty end; the planner shows an explicitly estimated 30-minute interval. End times must be later on the same day.

Projects are stored in the existing authenticated `users/{uid}` document alongside `tasks` and `completedTasks`, using merge writes and the existing owner-only Firestore rules. Local projects use `natija-projects-v2`. Account changes clear project data with task data. Debounced writes are bound to their originating UID. Scheduling changes invalidate reminder delivery keys; end-only changes do not. Snoozing now carries the date past midnight and preserves duration where it fits within the day.

Migration is lazy and additive, persisted on the next normal save. Older clients can still read date/time/completed and preserve unknown task properties during existing edit operations. The pre-existing whole-array synchronization is not a transactional conflict-resolution system: simultaneous edits or stale older clients can overwrite newer task metadata. Use the isolated preview for experimentation; use a test Firebase account for cloud validation before merging.

## Preview and verification

Serve this directory with a static HTTP server and open `/preview.html` (for example `python -m http.server 4173`). No dependency installation or build is needed. Do not open as `file://`.

Run `node --test tests/*.test.cjs`. Tests cover legacy migration, time ranges/overlaps, reminder invalidation, preview isolation, JS syntax, project payloads and pending writes during account changes. Browser smoke checks cover create/edit/reload, Kanban and subtasks. Real Firebase login, two-device sync and push/email/Telegram delivery require a test account and were not exercised against production.

The branch-only workflow uploads `natija-2-web-preview` under GitHub Actions; download, extract, serve, then open `preview.html`. This workflow has read-only repository permissions and no Pages deployment step. It is an artifact preview, not a hosted public URL.

This release implements Calendar/Notion-style workflows inside Natija. It does not connect to Google Calendar or Notion APIs. Drag-and-drop scheduling, cross-midnight events and independent subtask reminders are not included.
