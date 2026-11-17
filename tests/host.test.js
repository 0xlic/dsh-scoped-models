import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';

function setup(initialSettings = { enabled: false, models: [] }) {
  let settings = structuredClone(initialSettings);
  let revision = 0;
  const routes = new Map(); const tools = new Map(); const cleanup = [];
  const full = { default: { provider: 'openai-codex', model: 'codex' }, routableProviders: ['openrouter', 'openai-codex'], failures: [], groups: [
    { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'a/b', name: 'Model A' }, { id: 'c/d', name: 'Model B' }] },
    { id: 'openai-codex', name: 'ChatGPT subscription', models: [{ id: 'codex', name: 'Codex', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] },
  ] };
  const config = { enabled: { get: () => settings.enabled }, models: { get: () => settings.models }, reasoningDefaults: { get: () => settings.reasoningDefaults } };
  const events = [];
  // Mirror DSH's normalization boundary: both lookup and prepared calls pass here.
  const llm = {
    normalizeModelInfo(registration, model, resolved) { return structuredClone(resolved); },
    async resolveModelInfo(provider, model) {
      const info = full.groups.find(group => group.id === provider)?.models.find(item => item.id === model);
      if (!info) throw new Error('Unknown model');
      return this.normalizeModelInfo({ provider: { id: provider } }, model, { ...info, provider });
    },
    async prepareCall(config) {
      const info = await this.resolveModelInfo(config.provider, config.model);
      const effort = config.reasoningEffort ?? info.reasoning?.defaultEffort;
      if (effort !== undefined && !info.reasoning?.efforts.some(item => item.id === effort)) throw new Error('Unsupported explicit effort');
      return { config: effort === undefined ? config : { ...config, reasoningEffort: effort }, modelInfo: info };
    },
  };
  const originalNormalization = llm.normalizeModelInfo;
  const ctx = {
    fiber: { entry: { options: { id: 'include:scoped-models' } }, effectiveConfig: config },
    effect(fn) { const dispose = fn(); if (dispose) cleanup.push(dispose); },
    emit(event) { events.push(event); }, provide(key, value) { this[key] = value; },
    llm,
    sessionController: { async modelCatalog() { return { ...full, groups: await Promise.all(full.groups.map(async group => ({ ...group, models: await Promise.all(group.models.map(model => llm.resolveModelInfo(group.id, model.id))) }))) }; } },
    settings: {
      configure: () => () => {},
      describe: () => [{ ns: 'include:scoped-models', revision }],
      async update(ns, next, expected) {
        assert.equal(ns, 'include:scoped-models');
        if (expected !== undefined && expected !== revision) throw new Error('Settings revision conflict');
        settings = structuredClone(next); ++revision;
      },
    },
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  };
  const original = ctx.sessionController.modelCatalog;
  apply(ctx, config);
  return { ctx, routes, events, originalNormalization, tool: tools.get('scoped_models'), full, original, async close() { for (const fn of cleanup.reverse()) await fn(); }, async request(action, payload, envelope = {}) {
    const route = routes.get(`/api/scoped-models/${action}`);
    return route.fetch(new Request(`http://localhost/api/scoped-models/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test-id', method: `scoped-models/${action}`, payload, ...envelope }) }));
  } };
}

test('missing enabled setting defaults to filtered scope, including an empty selection', async () => {
  const app = setup({ models: [] });
  try {
    const listed = await app.tool.execute({ action: 'list' });
    assert.equal(listed.settings.enabled, true);
    assert.deepEqual((await app.ctx.sessionController.modelCatalog()).groups, []);
    // Management must remain complete so a first model can always be selected.
    assert.equal(listed.models.length, 3);
    await app.tool.execute({ action: 'set', enabled: true, models: [{ provider: 'openrouter', model: 'a/b' }], revision: listed.revision });
    assert.deepEqual((await app.ctx.sessionController.modelCatalog()).groups.map(group => group.models.map(model => model.id)), [['a/b']]);
  } finally { await app.close(); }
});

test('tool update filters native catalog while management route retains complete Codex + OpenRouter catalog', async () => {
  const app = setup();
  try {
    const initial = await app.tool.execute({ action: 'list', query: 'codex' });
    assert.equal(initial.models.length, 1); assert.equal(initial.total, 3);
    await app.tool.execute({ action: 'set', enabled: true, models: [{ provider: 'openai-codex', model: 'codex' }], revision: initial.revision });
    const native = await app.ctx.sessionController.modelCatalog();
    assert.equal(native.groups.length, 1); assert.equal(native.groups[0].id, 'openai-codex');
    assert.equal(native.groups[0].models[0].reasoning.efforts[0].id, 'high');
    const response = await (await app.request('read', {})).json();
    assert.equal(response.rpcId, 'test-id'); assert.equal(response.result.ok, true);
    assert.equal(response.result.value.total, 3); assert.equal(response.result.value.visible, 1);
    assert.equal(response.result.value.groups.length, 2);
  } finally { await app.close(); }
});
test('UI and tool update share settings, revision conflicts, and disabling restores full list', async () => {
  const app = setup();
  try {
    const result = await (await app.request('update', { settings: { enabled: true, models: [{ provider: 'openrouter', model: 'a/b' }] }, revision: 0 })).json();
    assert.equal(result.result.ok, true);
    const listed = await app.tool.execute({ action: 'list' });
    assert.deepEqual(listed.settings.models, [{ provider: 'openrouter', model: 'a/b' }]);
    await assert.rejects(app.tool.execute({ action: 'set', enabled: false, models: [], revision: 0 }), /conflict/);
    await app.tool.execute({ action: 'set', enabled: false, models: listed.settings.models, revision: listed.revision });
    assert.equal((await app.ctx.sessionController.modelCatalog()).groups.length, 2);
  } finally { await app.close(); }
});
test('reject unavailable new models but allow clearing the selected scope', async () => {
  const app = setup();
  try {
    await assert.rejects(app.tool.execute({ action: 'set', enabled: true, models: [{ provider: 'unknown', model: 'none' }] }), /unavailable/);
    await assert.rejects(app.tool.execute({ action: 'set', enabled: false, models: [{ provider: 'unknown', model: 'none' }] }), /unavailable/);
    assert.equal((await app.ctx.sessionController.modelCatalog()).groups.length, 2);
    await app.tool.execute({ action: 'set', enabled: true, models: [] });
    assert.deepEqual((await app.ctx.sessionController.modelCatalog()).groups, []);
  } finally { await app.close(); }
});
test('legacy Codex accounts share one management configuration across RPC, tools and account changes', async () => {
  const app = setup({ enabled: true, models: [
    { provider: 'codex-old', model: 'a' }, { provider: 'codex-work', model: 'a' }, { provider: 'codex-old', model: 'missing' },
  ] });
  const account = (id, models) => ({ id, name: id, models: models.map(id => ({ id, name: id })) });
  app.full.groups.push(account('codex-work', ['a', 'b']), account('codex-home', ['a', 'c']));
  try {
    const read = (await (await app.request('read', {})).json()).result.value;
    assert.deepEqual(read.settings.models, [{ provider: 'codex', model: 'a' }, { provider: 'codex', model: 'missing' }]);
    assert.deepEqual(read.groups.find(group => group.id === 'codex').models.map(model => model.id), ['a', 'b', 'c']);
    assert.equal(read.total, 6); assert.equal(read.visible, 2);
    assert.deepEqual(read.missing, [{ provider: 'codex', model: 'missing' }]);
    const listed = await app.tool.execute({ action: 'list', query: 'codex' });
    assert.equal(listed.models.filter(model => model.provider === 'codex').length, 3);
    const saved = (await (await app.request('update', { settings: { enabled: true, models: [
      { provider: 'codex-home', model: 'b' }, { provider: 'codex-work', model: 'b' }, { provider: 'codex-old', model: 'missing' },
    ] }, revision: read.revision })).json()).result;
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.value.settings.models, [{ provider: 'codex', model: 'b' }, { provider: 'codex', model: 'missing' }]);
    // A newly signed-in account inherits the same choice; no per-account save.
    app.full.groups.splice(2, 2, account('codex-new', ['a', 'b']));
    const native = await app.ctx.sessionController.modelCatalog();
    assert.deepEqual(native.groups.map(group => [group.id, group.models.map(model => model.id)]), [['codex-new', ['b']]]);
    app.full.groups.splice(2);
    const offline = await app.tool.execute({ action: 'list' });
    assert.equal(offline.missing.length, 2);
    await app.tool.execute({ action: 'set', enabled: false, models: offline.settings.models, revision: offline.revision });
    await assert.rejects(app.tool.execute({ action: 'set', enabled: false, models: [{ provider: 'codex', model: 'unknown' }] }), /unavailable/);
  } finally { await app.close(); }
});

test('reasoning defaults work for every capable provider with filtering off and explicit controls win', async () => {
  const app = setup();
  app.full.groups[0].models[0].reasoning = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' };
  try {
    const defaults = [{ provider: 'openrouter', model: 'a/b', effort: 'high' }, { provider: 'openai-codex', model: 'codex', effort: 'high' }];
    const saved = (await (await app.request('update', { settings: { enabled: false, models: [], reasoningDefaults: defaults }, revision: 0 })).json()).result;
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.value.settings.reasoningDefaults, defaults);
    assert.equal(app.events.at(-1), 'llm/adapters-updated');
    const listed = await app.tool.execute({ action: 'list' });
    assert.equal(listed.models.find(model => model.model === 'a/b').reasoning.defaultEffort, 'high');
    assert.equal((await app.ctx.llm.prepareCall({ provider: 'openrouter', model: 'a/b' })).config.reasoningEffort, 'high');
    assert.equal((await app.ctx.llm.prepareCall({ provider: 'openrouter', model: 'a/b', reasoningEffort: 'low' })).config.reasoningEffort, 'low');
    await assert.rejects(app.ctx.llm.prepareCall({ provider: 'openrouter', model: 'a/b', reasoningEffort: 'invalid' }), /Unsupported explicit/);
    assert.equal((await app.ctx.sessionController.modelCatalog()).groups.length, 2);
    assert.equal(app.full.groups[0].models[0].reasoning.defaultEffort, 'low');
    // Older callers omitting defaults cannot erase them.
    await app.tool.execute({ action: 'set', enabled: false, models: [] });
    assert.deepEqual((await app.tool.execute({ action: 'list' })).settings.reasoningDefaults, defaults);
    await assert.rejects(app.tool.execute({ action: 'set', enabled: false, models: [], reasoningDefaults: [], revision: 0 }), /conflict/);
    await app.tool.execute({ action: 'set', enabled: false, models: [], reasoningDefaults: [] });
    assert.equal((await app.ctx.llm.prepareCall({ provider: 'openrouter', model: 'a/b' })).config.reasoningEffort, 'low');
  } finally { await app.close(); }
});

test('reject newly unsupported defaults but retain saved unavailable defaults safely', async () => {
  const app = setup({ enabled: false, models: [], reasoningDefaults: [{ provider: 'gone', model: 'offline', effort: 'high' }] });
  try {
    for (const item of [
      { provider: 'openrouter', model: 'a/b', effort: 'high' },
      { provider: 'openai-codex', model: 'codex', effort: 'low' },
      { provider: 'unknown', model: 'missing', effort: 'high' },
    ]) await assert.rejects(app.tool.execute({ action: 'set', enabled: false, models: [], reasoningDefaults: [item] }), /Unsupported default/);
    const listed = await app.tool.execute({ action: 'list' });
    await app.tool.execute({ action: 'set', enabled: false, models: [], reasoningDefaults: listed.settings.reasoningDefaults });
    assert.equal((await app.tool.execute({ action: 'list' })).settings.reasoningDefaults.length, 1);
  } finally { await app.close(); }
});

test('Codex defaults share capabilities, survive sign-out and fall back for unsupported accounts', async () => {
  const app = setup();
  const account = (id, ids) => ({ id, name: id, models: [{ id: 'shared', name: 'Shared', reasoning: { efforts: ids.map(id => ({ id, name: id })), defaultEffort: ids[0] } }] });
  app.full.groups.push(account('codex-work', ['low']), account('codex-home', ['low', 'high']));
  try {
    const listed = await app.tool.execute({ action: 'list', query: 'shared' });
    assert.deepEqual(listed.models[0].reasoning.efforts.map(effort => effort.id), ['low', 'high']);
    await app.tool.execute({ action: 'set', enabled: false, models: [], reasoningDefaults: [{ provider: 'codex-home', model: 'shared', effort: 'high' }] });
    assert.equal((await app.ctx.llm.prepareCall({ provider: 'codex-work', model: 'shared' })).config.reasoningEffort, 'low');
    assert.equal((await app.ctx.llm.prepareCall({ provider: 'codex-home', model: 'shared' })).config.reasoningEffort, 'high');
    app.full.groups.splice(2);
    await app.tool.execute({ action: 'set', enabled: false, models: [] });
    app.full.groups.push(account('codex-new', ['low', 'high']));
    assert.equal((await app.ctx.llm.prepareCall({ provider: 'codex-new', model: 'shared' })).config.reasoningEffort, 'high');
    app.full.groups[2].models[0].reasoning = undefined;
    assert.equal((await app.ctx.llm.prepareCall({ provider: 'codex-new', model: 'shared' })).config.reasoningEffort, undefined);
  } finally { await app.close(); }
});

test('bad envelopes and wrong endpoints never mutate settings', async () => {
  const app = setup();
  try {
    assert.equal((await app.request('read', {}, { type: 'wrong' })).status, 400);
    assert.equal((await app.request('read', {}, { method: 'other' })).status, 400);
    const response = await (await app.request('update', { settings: { enabled: 'yes', models: [] } })).json();
    assert.equal(response.result.ok, false);
    assert.equal((await app.tool.execute({ action: 'list' })).settings.enabled, false);
  } finally { await app.close(); }
});
test('dispose restores the native service and removes plugin routes', async () => {
  const app = setup();
  assert.notEqual(app.ctx.sessionController.modelCatalog, app.original);
  await app.close();
  assert.equal(app.ctx.sessionController.modelCatalog, app.original);
  assert.equal(app.ctx.llm.normalizeModelInfo, app.originalNormalization);
  assert.equal(app.routes.size, 0);
});
