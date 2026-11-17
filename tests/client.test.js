import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
test('settings icon registers only its own ID and inherits theme color at native sizes', () => {
  let definition, registration;
  vm.runInNewContext(source, {window: {__ModuleLoader__: {load(value) { definition = value; }}}});
  definition.factory(() => ({createElement: (type, props, ...children) => ({type, props, children})})).apply({
    effect: fn => fn(),
    locale: {register() {}, bind: () => key => key},
    slots: {
      inject: (name, setup) => { if (name === 'settings.section.icon') setup(); },
      register: (options, component) => { registration = {options, component}; return () => {}; },
    },
  });
  assert.equal(registration.options.id, 'scoped-models');
  for (const size of [16, 20, 24]) {
    const svg = registration.component({size, active: true});
    assert.equal(svg.type, 'svg');
    assert.equal(svg.props.width, size);
    assert.equal(svg.props.height, size);
    assert.equal(svg.props.stroke, 'currentColor');
    assert.equal(svg.props.viewBox, '0 0 16 16');
    assert.equal(svg.props['aria-hidden'], true);
    assert.equal(svg.children.length, 2, 'funnel and check');
  }
});

const entry = (model, effort) => ({ provider: 'codex', model, effort });
const pair = model => ({ provider: 'codex', model });
function fixture(settings = {}) {
  return {
    revision: 1,
    settings: { enabled: true, models: [], ...settings },
    groups: [{ id: 'codex', name: 'Codex', models: [
      { id: 'smart', name: 'Smart model', reasoning: { efforts: [{ id: 'low', name: 'Low effort' }, { id: 'high', name: 'High effort' }] } },
      { id: 'plain', name: 'Plain model' },
      { id: 'empty', name: 'Empty efforts', reasoning: { efforts: [] } },
    ] }],
    total: 3,
    failures: [],
  };
}

// This renders the plugin's real component with deterministic hook storage. No
// browser, React dependency, implementation internals, or state-slot IDs needed.
async function mount(initial = fixture(), language = 'en') {
  const hooks = [];
  const effects = [];
  const requests = [];
  let cursor = 0;
  let component;
  let tree;
  let messages;
  let definition;
  let readResult = initial;
  let serverRevision = initial.revision;
  let writes = 0;
  const cleanups = [];
  const updateResponses = [];
  const readResponses = [];
  function defer(queue) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = value => yes({ ok: true, value }); reject = no; });
    queue.push(promise);
    return { resolve, reject };
  }
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity).filter(child => child != null && child !== false && child !== '') };
    },
    useState(value) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = value;
      return [hooks[index], next => { ++writes; hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useRef(value) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: value };
      return hooks[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!(index in hooks)) { hooks[index] = true; effects.push(effect); }
    },
    useSyncExternalStore() {},
  };
  vm.runInNewContext(source, {
    AbortController,
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
  }, { filename: 'client.js' });
  definition.factory(name => {
    assert.equal(name, 'react');
    return React;
  }).apply({
    effect: effect => effect(),
    on: () => () => {},
    locale: {
      register(_namespace, value) { messages = value; },
      bind: () => key => messages[language][key],
      subscribe: () => () => {},
      getSnapshot: () => language,
    },
    slots: {
      inject: (_name, setup) => setup(),
      register(_options, value) { component = value; return () => {}; },
    },
    connection: { rpc: { async call(path, method, payload, signal) {
      assert.equal(path, '/api');
      // Normalize cross-realm arrays/objects for strict comparisons in tests.
      const request = { method, payload: JSON.parse(JSON.stringify(payload)) };
      requests.push({ ...request, signal });
      if (method === 'scoped-models/read') return readResponses.length ? readResponses.shift() : { ok: true, value: readResult };
      assert.equal(method, 'scoped-models/update');
      return updateResponses.length ? updateResponses.shift() : { ok: true, value: { revision: ++serverRevision, settings: request.payload.settings } };
    } } },
  });
  function render() {
    cursor = 0;
    tree = component();
    for (const effect of effects.splice(0)) cleanups.push(effect());
    return tree;
  }
  async function settle() {
    await new Promise(resolve => setImmediate(resolve));
    render();
  }
  render();
  await settle();
  return {
    get tree() { return tree; }, requests, render, settle,
    setReadResult(value) { readResult = value; },
    deferUpdate() { return defer(updateResponses); },
    deferRead() { return defer(readResponses); },
    get writes() { return writes; },
    unmount() { for (const cleanup of cleanups.splice(0)) cleanup?.(); },
    async check(node, checked) { node.props.onChange({ target: { checked } }); await settle(); },
    async change(node, value) { node.props.onChange({ target: { value } }); await settle(); },
    async click(node) { await node.props.onClick(); await settle(); },
  };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap(child => nodes(child, predicate))];
}
function text(tree) {
  return typeof tree === 'object' && tree !== null ? tree.children.map(text).join('') : String(tree);
}
const select = (ui, modelName) => nodes(ui.tree, node => node.type === 'select' && node.props['aria-label']?.endsWith(` · ${modelName}`))[0];
const button = (ui, name) => nodes(ui.tree, node => node.type === 'button' && text(node) === name)[0];
const modelRow = (ui, id) => nodes(ui.tree, node => node.props.className === 'scope-row' && node.props.key === id)[0];
const checkbox = (ui, id) => nodes(modelRow(ui, id), node => node.type === 'input' && node.props.type === 'checkbox')[0];
const lastUpdate = ui => ui.requests.filter(request => request.method === 'scoped-models/update').at(-1).payload;

test('reasoning controls use metadata only for supported models and are outside checkbox labels', async () => {
  const ui = await mount(fixture({ models: [pair('smart')] }));
  const control = select(ui, 'Smart model');
  assert.ok(control);
  assert.equal(select(ui, 'Plain model'), undefined);
  assert.equal(select(ui, 'Empty efforts'), undefined);
  assert.deepEqual(control.children.map(option => [option.props.value, text(option)]), [
    ['', 'Provider default'], ['low', 'Low effort'], ['high', 'High effort'],
  ]);
  assert.equal(modelRow(ui, 'smart').type, 'div');
  const labels = nodes(modelRow(ui, 'smart'), node => node.type === 'label');
  assert.equal(labels.length, 1);
  assert.equal(nodes(labels[0], node => node.type === 'select').length, 0);
  assert.doesNotMatch(text(modelRow(ui, 'smart')), /Default reasoning level/);
  assert.match(text(nodes(ui.tree, node => node.props.className === 'scope-group')[0]), /Default reasoning level/);
  assert.equal(nodes(ui.tree, node => node.props.role === 'switch').length, 0);
  assert.equal(button(ui, 'Save scope'), undefined);
});

test('bilingual reasoning labels and provider-default option include the model name accessibly', async () => {
  const ui = await mount(fixture({ models: [pair('smart')] }), 'zh');
  const control = select(ui, 'Smart model');
  assert.equal(control.props['aria-label'], '默认思考等级 · Smart model');
  assert.equal(text(control.children[0]), '跟随提供商默认');
  assert.doesNotMatch(text(modelRow(ui, 'smart')), /默认思考等级/);
  assert.match(text(nodes(ui.tree, node => node.props.className === 'scope-group')[0]), /默认思考等级/);
});

test('reasoning heading appears once per provider with visible selected capable models', async () => {
  const data = fixture({ models: [pair('smart'), pair('second'), { provider: 'reasoning-provider', model: 'smart' }] });
  data.groups[0].models.push({ id: 'second', name: 'Second model', reasoning: { efforts: [{ id: 'high', name: 'High' }] } });
  data.groups.push({ id: 'plain-provider', name: 'Plain provider', models: [{ id: 'plain', name: 'Plain' }] });
  data.groups.push({ id: 'reasoning-provider', name: 'Reasoning provider', models: [{ id: 'smart', name: 'Other smart', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }] });
  const ui = await mount(data);
  const headers = nodes(ui.tree, node => node.props.className === 'scope-group');
  assert.equal(headers.length, 3);
  assert.match(text(headers[0]), /Default reasoning level/);
  assert.doesNotMatch(text(headers[1]), /Default reasoning level/);
  assert.match(text(headers[2]), /Default reasoning level/);
  assert.equal(nodes(ui.tree, node => node.props.className === 'scope-meta scope-reasoning-heading').length, 2);
  for (const row of nodes(ui.tree, node => node.props.className === 'scope-row')) assert.doesNotMatch(text(row), /Default reasoning level/);
  assert.ok(select(ui, 'Second model'));
});

test('unchecked persisted defaults hide controls and headings, survive deselection, and reject stale changes', async () => {
  const ui = await mount(fixture({ reasoningDefaults: [entry('smart', 'low')] }));
  const headings = () => nodes(ui.tree, node => node.props.className === 'scope-meta scope-reasoning-heading');
  assert.equal(select(ui, 'Smart model'), undefined);
  assert.equal(headings().length, 0);
  assert.equal(ui.requests.filter(request => request.method === 'scoped-models/update').length, 0);

  await ui.check(checkbox(ui, 'smart'), true);
  assert.equal(select(ui, 'Smart model').props.value, 'low');
  assert.equal(headings().length, 1);
  await ui.change(select(ui, 'Smart model'), 'high');
  const staleControl = select(ui, 'Smart model');
  await ui.check(checkbox(ui, 'smart'), false);
  assert.equal(select(ui, 'Smart model'), undefined);
  assert.equal(headings().length, 0);
  assert.deepEqual(lastUpdate(ui).settings, { enabled: true, models: [], reasoningDefaults: [entry('smart', 'high')] });
  const requests = ui.requests.length;
  const writes = ui.writes;
  await ui.change(staleControl, 'low');
  await ui.change(staleControl, '');
  assert.equal(ui.requests.length, requests);
  assert.equal(ui.writes, writes);
  assert.deepEqual(lastUpdate(ui).settings.reasoningDefaults, [entry('smart', 'high')]);

  await ui.check(checkbox(ui, 'smart'), true);
  assert.equal(select(ui, 'Smart model').props.value, 'high');
  assert.equal(headings().length, 1);
  assert.deepEqual(lastUpdate(ui).settings.reasoningDefaults, [entry('smart', 'high')]);
  ui.unmount();
});

test('provider headings require a visible selected capable or persisted-default model', async () => {
  const ui = await mount(fixture({ models: [pair('plain')], reasoningDefaults: [entry('plain', 'high')] }));
  const headings = () => nodes(ui.tree, node => node.props.className === 'scope-meta scope-reasoning-heading');
  assert.equal(headings().length, 1);
  assert.equal(select(ui, 'Plain model').props.value, 'high');
  assert.equal(select(ui, 'Smart model'), undefined);
  const search = () => nodes(ui.tree, node => node.type === 'input' && node.props.type === 'search')[0];
  await ui.change(search(), 'Smart');
  assert.equal(headings().length, 0);
  await ui.change(search(), '');
  assert.equal(headings().length, 1);
  await ui.change(select(ui, 'Plain model'), '');
  assert.equal(headings().length, 0);
  assert.equal(select(ui, 'Plain model'), undefined);
  ui.unmount();
});

test('missing-default section only includes selected missing models and retains hidden defaults', async () => {
  const defaults = [entry('gone', 'low'), entry('hidden', 'high')];
  const ui = await mount(fixture({ models: [pair('gone')], reasoningDefaults: defaults }));
  assert.equal(select(ui, 'gone').props.value, 'low');
  assert.equal(select(ui, 'hidden'), undefined);
  const cards = nodes(ui.tree, node => node.props.className === 'scope-card');
  assert.equal(cards.length, 2);
  assert.doesNotMatch(text(cards[1]), /hidden/);
  await ui.click(button(ui, 'Remove'));
  assert.equal(select(ui, 'gone'), undefined);
  assert.equal(nodes(ui.tree, node => node.props.className === 'scope-card').length, 0);
  assert.deepEqual(lastUpdate(ui).settings, { enabled: true, models: [], reasoningDefaults: defaults });
  ui.unmount();
});

test('model selections and reasoning edits automatically persist enabled scopes', async () => {
  const ui = await mount(fixture({ models: [pair('smart')] }));
  await ui.check(checkbox(ui, 'plain'), true);
  assert.deepEqual(lastUpdate(ui), { revision: 1, settings: { enabled: true, models: [pair('smart'), pair('plain')], reasoningDefaults: [] } });
  await ui.change(select(ui, 'Smart model'), 'high');
  assert.equal(checkbox(ui, 'smart').props.checked, true);
  assert.deepEqual(lastUpdate(ui), { revision: 2, settings: { enabled: true, models: [pair('smart'), pair('plain')], reasoningDefaults: [entry('smart', 'high')] } });
  await ui.change(select(ui, 'Smart model'), '');
  assert.deepEqual(lastUpdate(ui).settings.reasoningDefaults, []);
  assert.match(text(ui.tree), /Saved/);
  ui.unmount();
});

test('legacy disabled settings auto-enable without discarding selections or defaults', async () => {
  const ui = await mount(fixture({ enabled: false, models: [pair('gone')], reasoningDefaults: [entry('smart', 'high')] }));
  assert.deepEqual(lastUpdate(ui), { revision: 1, settings: { enabled: true, models: [pair('gone')], reasoningDefaults: [entry('smart', 'high')] } });
  const empty = await mount(fixture({ enabled: false }));
  assert.deepEqual(lastUpdate(empty).settings, { enabled: true, models: [], reasoningDefaults: [] });
  ui.unmount(); empty.unmount();
});

test('in-flight edits coalesce with the latest revision and acknowledgements never replace a newer draft', async () => {
  const ui = await mount();
  const first = ui.deferUpdate();
  const second = ui.deferUpdate();
  await ui.check(checkbox(ui, 'smart'), true);
  assert.equal(checkbox(ui, 'plain').props.disabled, false);
  assert.equal(select(ui, 'Smart model').props.disabled, false);
  await ui.check(checkbox(ui, 'plain'), true);
  await ui.change(select(ui, 'Smart model'), 'high');
  await ui.check(checkbox(ui, 'smart'), false);
  assert.equal(ui.requests.length, 2);
  first.resolve({ revision: 9, settings: { enabled: true, models: [pair('smart')], reasoningDefaults: [] } });
  await ui.settle();
  assert.equal(ui.requests.length, 3);
  assert.deepEqual(lastUpdate(ui), { revision: 9, settings: { enabled: true, models: [pair('plain')], reasoningDefaults: [entry('smart', 'high')] } });
  assert.equal(checkbox(ui, 'smart').props.checked, false);
  assert.equal(checkbox(ui, 'plain').props.checked, true);
  assert.equal(select(ui, 'Smart model'), undefined);
  second.resolve({ revision: 10, settings: { enabled: true, models: [], reasoningDefaults: [] } });
  await ui.settle();
  assert.equal(checkbox(ui, 'plain').props.checked, true);
  assert.equal(select(ui, 'Smart model'), undefined);
  await ui.check(checkbox(ui, 'smart'), true);
  assert.equal(select(ui, 'Smart model').props.value, 'high');
  ui.unmount();
});

test('deselecting the last model persists an intentionally empty scope', async () => {
  const ui = await mount(fixture({ models: [pair('plain')] }));
  await ui.check(checkbox(ui, 'plain'), false);
  assert.deepEqual(lastUpdate(ui).settings, { enabled: true, models: [], reasoningDefaults: [] });
  assert.equal(nodes(ui.tree, node => node.props.role === 'alert').length, 0);
  ui.unmount();
});

test('refresh waits for all writes and keeps the draft while catalog read is pending', async () => {
  const ui = await mount(fixture({ models: [pair('plain'), pair('smart')], reasoningDefaults: [entry('smart', 'low')] }));
  const first = ui.deferUpdate();
  const second = ui.deferUpdate();
  const read = ui.deferRead();
  await ui.change(select(ui, 'Smart model'), 'high');
  await ui.change(select(ui, 'Smart model'), '');
  const refresh = button(ui, 'Refresh catalog').props.onClick();
  await ui.settle();
  assert.equal(ui.requests.length, 2);
  first.resolve({ revision: 2 }); await ui.settle();
  assert.equal(lastUpdate(ui).revision, 2);
  assert.equal(ui.requests.length, 3);
  second.resolve({ revision: 3 }); await ui.settle();
  assert.equal(ui.requests.at(-1).method, 'scoped-models/read');
  const refreshed = fixture({ models: [], reasoningDefaults: [entry('smart', 'low')] });
  refreshed.revision = 3;
  read.resolve(refreshed); await refresh; await ui.settle();
  assert.equal(select(ui, 'Smart model').props.value, '');
  assert.equal(checkbox(ui, 'plain').props.checked, true);
  assert.equal(checkbox(ui, 'smart').props.checked, true);
  await ui.check(checkbox(ui, 'plain'), false);
  assert.equal(lastUpdate(ui).revision, 3);
  ui.unmount();
});

test('unavailable persisted defaults and missing selections are independently removable', async () => {
  const ui = await mount(fixture({
    models: [pair('smart'), pair('plain'), pair('gone')],
    reasoningDefaults: [entry('smart', 'retired'), entry('plain', 'high'), entry('gone', 'low')],
  }));
  for (const [name, value] of [['Smart model', 'retired'], ['Plain model', 'high'], ['gone', 'low']]) {
    const control = select(ui, name);
    assert.equal(control.props.value, value);
    const unavailable = control.children.find(option => option.props.value === value);
    assert.equal(unavailable.props.disabled, true);
    assert.match(text(unavailable), /Unavailable/);
    assert.equal(control.children[0].props.value, '');
    assert.notEqual(control.children[0].props.disabled, true);
  }
  await ui.change(select(ui, 'Smart model'), '');
  await ui.change(select(ui, 'Plain model'), '');
  await ui.change(select(ui, 'gone'), '');
  assert.equal(select(ui, 'Plain model'), undefined);
  assert.equal(select(ui, 'gone'), undefined);
  assert.deepEqual(lastUpdate(ui).settings, { enabled: true, models: [pair('smart'), pair('plain'), pair('gone')], reasoningDefaults: [] });
  await ui.click(button(ui, 'Remove'));
  assert.deepEqual(lastUpdate(ui).settings.models, [pair('smart'), pair('plain')]);
  ui.unmount();
});

test('failed writes retain edits, pause automatic retries, and explicitly retry the latest draft', async () => {
  const ui = await mount();
  const failed = ui.deferUpdate();
  await ui.check(checkbox(ui, 'smart'), true);
  await ui.change(select(ui, 'Smart model'), 'high');
  failed.reject(new Error('Connection lost'));
  await ui.settle();
  assert.match(text(nodes(ui.tree, node => node.props.role === 'alert')[0]), /Connection lost/);
  assert.equal(checkbox(ui, 'smart').props.checked, true);
  await ui.check(checkbox(ui, 'plain'), true);
  await ui.change(select(ui, 'Smart model'), 'low');
  await ui.settle(); await ui.settle();
  assert.equal(ui.requests.length, 2);
  assert.ok(button(ui, 'Retry save'));
  await ui.click(button(ui, 'Retry save'));
  assert.equal(ui.requests.length, 3);
  assert.deepEqual(lastUpdate(ui), { revision: 1, settings: { enabled: true, models: [pair('smart'), pair('plain')], reasoningDefaults: [entry('smart', 'low')] } });
  assert.equal(nodes(ui.tree, node => node.props.role === 'alert').length, 0);
  assert.equal(button(ui, 'Retry save'), undefined);
  ui.unmount();
});

test('refresh after failed writes preserves the unsaved draft and acquires a safe revision for retry', async () => {
  const ui = await mount();
  const failed = ui.deferUpdate();
  await ui.check(checkbox(ui, 'smart'), true);
  failed.reject(new Error('Revision conflict')); await ui.settle();
  ui.setReadResult({ ...fixture(), revision: 8 });
  await ui.click(button(ui, 'Refresh catalog'));
  assert.equal(checkbox(ui, 'smart').props.checked, true);
  assert.equal(ui.requests.filter(request => request.method === 'scoped-models/update').length, 1);
  await ui.click(button(ui, 'Retry save'));
  assert.equal(lastUpdate(ui).revision, 8);
  ui.unmount();
});

test('closing settings finishes queued writes without updating unmounted UI, and aborts stale reads', async () => {
  const ui = await mount();
  const pending = ui.deferUpdate();
  const latest = ui.deferUpdate();
  await ui.check(checkbox(ui, 'smart'), true);
  await ui.check(checkbox(ui, 'plain'), true);
  ui.unmount();
  const writes = ui.writes;
  assert.equal(ui.requests.at(-1).signal, undefined);
  pending.resolve({ revision: 2 }); await ui.settle();
  assert.equal(ui.writes, writes);
  assert.equal(ui.requests.length, 3);
  assert.deepEqual(lastUpdate(ui), { revision: 2, settings: { enabled: true, models: [pair('smart'), pair('plain')], reasoningDefaults: [] } });
  latest.resolve({ revision: 3 }); await ui.settle();
  assert.equal(ui.writes, writes);

  const refreshing = await mount();
  const read = refreshing.deferRead();
  const refresh = button(refreshing, 'Refresh catalog').props.onClick();
  await refreshing.settle(); refreshing.unmount();
  const before = refreshing.writes;
  read.resolve({ ...fixture(), revision: 9 }); await refresh; await refreshing.settle();
  assert.equal(refreshing.writes, before);
  assert.equal(refreshing.requests.at(-1).signal.aborted, true);
});
