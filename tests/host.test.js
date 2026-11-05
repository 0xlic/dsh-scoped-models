import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';

function setup() {
  let settings = { enabled: false, models: [] };
  let revision = 0;
  const routes = new Map(); const tools = new Map(); const cleanup = [];
  const full = { default: { provider: 'openai-codex', model: 'codex' }, routableProviders: ['openrouter', 'openai-codex'], failures: [], groups: [
    { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'a/b', name: 'Model A' }, { id: 'c/d', name: 'Model B' }] },
    { id: 'openai-codex', name: 'ChatGPT subscription', models: [{ id: 'codex', name: 'Codex', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] },
  ] };
  const config = { enabled: { get: () => settings.enabled }, models: { get: () => settings.models } };
  const ctx = {
    fiber: { entry: { options: { id: 'include:scoped-models' } }, effectiveConfig: config },
    effect(fn) { const dispose = fn(); if (dispose) cleanup.push(dispose); },
    emit() {}, provide(key, value) { this[key] = value; },
    sessionController: { async modelCatalog() { return full; } },
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
  return { ctx, routes, tool: tools.get('scoped_models'), full, original, async close() { for (const fn of cleanup.reverse()) await fn(); }, async request(action, payload, envelope = {}) {
    const route = routes.get(`/api/scoped-models/${action}`);
    return route.fetch(new Request(`http://localhost/api/scoped-models/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test-id', method: `scoped-models/${action}`, payload, ...envelope }) }));
  } };
}

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
test('reject unavailable newly selected models and empty enabled scope', async () => {
  const app = setup();
  try {
    await assert.rejects(app.tool.execute({ action: 'set', enabled: true, models: [] }), /at least one/);
    await assert.rejects(app.tool.execute({ action: 'set', enabled: true, models: [{ provider: 'unknown', model: 'none' }] }), /available/);
    await assert.rejects(app.tool.execute({ action: 'set', enabled: false, models: [{ provider: 'unknown', model: 'none' }] }), /unavailable/);
    assert.equal((await app.ctx.sessionController.modelCatalog()).groups.length, 2);
  } finally { await app.close(); }
});
test('bad envelopes and wrong endpoints never mutate settings', async () => {
  const app = setup();
  try {
    assert.equal((await app.request('read', {}, { type: 'wrong' })).status, 400);
    assert.equal((await app.request('read', {}, { method: 'other' })).status, 400);
    const response = await (await app.request('update', { settings: { enabled: true, models: [] } })).json();
    assert.equal(response.result.ok, false);
    assert.equal((await app.tool.execute({ action: 'list' })).settings.enabled, false);
  } finally { await app.close(); }
});
test('dispose restores the native service and removes plugin routes', async () => {
  const app = setup();
  assert.notEqual(app.ctx.sessionController.modelCatalog, app.original);
  await app.close();
  assert.equal(app.ctx.sessionController.modelCatalog, app.original);
  assert.equal(app.routes.size, 0);
});
