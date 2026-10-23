const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const origin = 'https://example.test';
const source = fs.readFileSync('sw.js', 'utf8');
const keyFor = request => typeof request === 'string' ? request : request.url;

function harness({online = true, response = {ok: true, clone() { return this; }}, stored = []} = {}) {
  const handlers = new Map();
  const cache = new Map(stored);
  const fetches = [], writes = [], matches = [];
  const context = {
    URL,
    location: {origin},
    self: {
      location: {origin},
      addEventListener(type, handler) { handlers.set(type, handler); },
      skipWaiting() {},
      clients: {claim() {}}
    },
    caches: {
      async open() {
        return {
          async put(request, value) { writes.push(keyFor(request)); cache.set(keyFor(request), value); },
          async addAll() {}
        };
      },
      async match(request) { const key = keyFor(request); matches.push(key); return cache.get(key); },
      async keys() { return []; },
      async delete() { return true; }
    },
    async fetch(request, options) {
      fetches.push({request, options});
      if (!online) throw new Error('Offline');
      return response;
    }
  };
  vm.runInNewContext(source, context, {filename: 'sw.js'});
  function request(path, {mode = 'cors', method = 'GET'} = {}) {
    const url = new URL(path, origin).href;
    return {
      url, method, mode,
      destination: mode === 'navigate' ? 'document' : 'script',
      headers: {get: name => name.toLowerCase() === 'accept' && mode === 'navigate' ? 'text/html' : '*/*'}
    };
  }
  function dispatch(req) {
    let result;
    handlers.get('fetch')({request: req, respondWith(value) { result = value; }, waitUntil() {}});
    return result;
  }
  return {request, dispatch, fetches, writes, matches, response};
}

test('worker revalidates same-origin assets and caches a successful response', async () => {
  const worker = harness();
  const request = worker.request('/natija-v2.js?v=3');
  assert.equal(await worker.dispatch(request), worker.response);
  await new Promise(setImmediate);
  assert.equal(worker.fetches[0].request, request);
  assert.equal(worker.fetches[0].options.cache, 'no-cache');
  assert.deepEqual(worker.writes, [request.url]);
});

test('an unsuccessful network response is returned without replacing the cache', async () => {
  const response = {ok: false, status: 404, clone() { throw new Error('Must not cache an unsuccessful response'); }};
  const worker = harness({response});
  assert.equal(await worker.dispatch(worker.request('/missing.js')), response);
  await new Promise(setImmediate);
  assert.deepEqual(worker.writes, []);
});

test('offline assets use their exact cached response', async () => {
  const cached = {body: 'cached JavaScript'};
  const worker = harness({online: false, stored: [[origin + '/natija-v2.js?v=3', cached]]});
  const request = worker.request('/natija-v2.js?v=3');
  assert.equal(await worker.dispatch(request), cached);
  assert.deepEqual(worker.matches, [request.url]);
});

test('an uncached offline script rejects instead of receiving the HTML shell', async () => {
  const shell = {body: '<html>app shell</html>'};
  const worker = harness({online: false, stored: [['index.html', shell]]});
  await assert.rejects(worker.dispatch(worker.request('/missing.js')));
  assert.equal(worker.matches.includes('index.html'), false);
});

test('an offline navigation falls back to the cached HTML shell', async () => {
  const shell = {body: '<html>app shell</html>'};
  const worker = harness({online: false, stored: [['index.html', shell]]});
  const request = worker.request('/?preview=1', {mode: 'navigate'});
  assert.equal(await worker.dispatch(request), shell);
  assert.deepEqual(worker.matches, [request.url, 'index.html']);
});

test('requests to an external origin are not intercepted', () => {
  const worker = harness();
  assert.equal(worker.dispatch(worker.request('https://www.gstatic.com/firebase.js')), undefined);
  assert.deepEqual(worker.fetches, []);
  assert.deepEqual(worker.writes, []);
});
