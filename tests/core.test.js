import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalog, modelKey, normalizeSettings, wrapCatalog } from '../core.js';

const pair = (provider, model) => ({ provider, model });
const scope = (...models) => ({ enabled: true, models });
function fixture() {
  return {
    default: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high' },
    routableProviders: ['openrouter', 'openai-codex'], failures: [{ id: 'offline', name: 'Offline', message: 'network unavailable' }],
    groups: [
      { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'openai/shared', name: 'Shared OR' }, { id: 'other', name: 'Other' }] },
      { id: 'openai-codex', name: 'ChatGPT subscription', models: [{ id: 'gpt-6.1-sol', name: 'GPT 6.1', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }, { id: 'other', name: 'Other Codex' }] },
    ],
  };
}

test('disabled scope is the original catalog', () => {
  const catalog = fixture();
  assert.equal(filterCatalog(catalog, { enabled: false, models: [] }), catalog);
});
test('strict provider/model pairs; retain Codex reasoning and unrelated catalog fields', () => {
  const catalog = fixture();
  const filtered = filterCatalog(catalog, scope(pair('openai-codex', 'gpt-6.1-sol'), pair('openrouter', 'other')));
  assert.deepEqual(filtered.groups.map(g => [g.id, g.models.map(m => m.id)]), [['openrouter', ['other']], ['openai-codex', ['gpt-6.1-sol']]]);
  assert.equal(filtered.groups[1].models[0], catalog.groups[1].models[0]);
  assert.equal(filtered.default, catalog.default);
  assert.equal(filtered.routableProviders, catalog.routableProviders);
  assert.equal(filtered.failures, catalog.failures);
  assert.equal(catalog.groups[0].models.length, 2);
});
test('empty groups hidden; unavailable saved pairs are not resurrected', () => {
  assert.deepEqual(filterCatalog(fixture(), scope(pair('gone', 'missing'))).groups, []);
});
test('keys cannot collide on slashes or arbitrary IDs', () => {
  assert.notEqual(modelKey('a/b', 'c'), modelKey('a', 'b/c'));
});
test('settings validation deduplicates and preserves exact model IDs', () => {
  assert.deepEqual(normalizeSettings(scope(pair('openrouter', 'a/b'), pair('openrouter', 'a/b'))), scope(pair('openrouter', 'a/b')));
  assert.deepEqual(normalizeSettings({ enabled: false, models: [] }), { enabled: false, models: [] });
});
test('reject invalid or accidentally empty enabled scope', () => {
  for (const value of [null, [], {}, { enabled: true, models: [] }, { enabled: 'yes', models: [] }, scope(pair('', 'x')), scope({ provider: 'x', model: 'y', extra: true }), { enabled: false, models: [], extra: true }]) assert.throws(() => normalizeSettings(value));
});
test('wrapper and full management catalog stay separate, and re-read dynamic catalog', async () => {
  let settings = scope(pair('openai-codex', 'gpt-6.1-sol'));
  let catalog = fixture();
  const controller = { async modelCatalog() { return catalog; } };
  const original = controller.modelCatalog;
  const wrapper = wrapCatalog(controller, () => settings);
  assert.equal((await controller.modelCatalog()).groups.length, 1);
  assert.equal((await wrapper.full()).groups.length, 2);
  catalog = { ...catalog, groups: [...catalog.groups, { id: 'new-plugin', name: 'New', models: [{ id: 'dynamic', name: 'Dynamic model' }] }] };
  assert.equal((await wrapper.full()).groups.length, 3);
  settings = scope(pair('new-plugin', 'dynamic'));
  assert.equal((await controller.modelCatalog()).groups[0].id, 'new-plugin');
  wrapper.dispose();
  assert.equal(controller.modelCatalog, original);
});
test('wrapper preserves receiver and restores inherited descriptor', async () => {
  class Controller { async modelCatalog() { return this.catalog; } }
  const controller = new Controller(); controller.catalog = fixture();
  const original = controller.modelCatalog;
  const wrapper = wrapCatalog(controller, () => scope(pair('openrouter', 'other')));
  assert.equal((await wrapper.full()).groups.length, 2);
  assert.equal((await controller.modelCatalog()).groups.length, 1);
  wrapper.dispose();
  assert.equal(controller.modelCatalog, original);
  assert.equal(Object.hasOwn(controller, 'modelCatalog'), false);
});
test('unload does not overwrite later wrappers; captured wrapper becomes pass-through', async () => {
  const controller = { async modelCatalog() { return fixture(); } };
  const wrapper = wrapCatalog(controller, () => scope(pair('openrouter', 'other')));
  const captured = controller.modelCatalog;
  const later = async function () { return captured.call(this); };
  controller.modelCatalog = later;
  wrapper.dispose();
  assert.equal(controller.modelCatalog, later);
  assert.equal((await controller.modelCatalog()).groups.length, 2);
});
test('unload during catalog request cannot apply stale filtering', async () => {
  let finish;
  const controller = { modelCatalog() { return new Promise(resolve => { finish = resolve; }); } };
  const wrapper = wrapCatalog(controller, () => scope(pair('openrouter', 'other')));
  const pending = controller.modelCatalog();
  wrapper.dispose(); finish(fixture());
  assert.equal((await pending).groups.length, 2);
});
test('Cordis original symbol unwrapping patches real service rather than a proxy shadow', async () => {
  const raw = { async modelCatalog() { return fixture(); } };
  const proxy = new Proxy(raw, { get(target, key) { return key === Symbol.for('cordis.original') ? target : target[key]; } });
  const wrapper = wrapCatalog(proxy, () => scope(pair('openai-codex', 'gpt-6.1-sol')));
  assert.equal((await raw.modelCatalog()).groups[0].id, 'openai-codex');
  wrapper.dispose(); assert.equal((await raw.modelCatalog()).groups.length, 2);
});
test('provider failures remain failures and are not swallowed by the shim', async () => {
  const controller = { async modelCatalog() { throw new Error('Catalog failed'); } };
  const wrapper = wrapCatalog(controller, () => scope(pair('openrouter', 'other')));
  await assert.rejects(controller.modelCatalog(), /Catalog failed/);
  wrapper.dispose();
});
