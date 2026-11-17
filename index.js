import z from '@deepseek-ai/schemastery';
import { modelKey, normalizeSettings, scopeGroups, wrapCatalog, wrapReasoningDefaults } from './core.js';

// Small transport-envelope check; application payload validation stays below.
// No runtime dependency on a second copy of DSH's connection service.
const clientRequestSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'client-request' || typeof value.rpcId !== 'string' || typeof value.method !== 'string') throw new Error('Invalid RPC envelope');
    return value;
  },
};
export const name = 'scoped-models';
export const inject = ['sessionController', 'settings', 'connection', 'tools', 'llm'];
export const Config = z.object({
  enabled: z.boolean().default(true).extra('volatile', true),
  models: z.array(z.object({ provider: z.string().required(), model: z.string().required() })).default([]).extra('volatile', true),
  reasoningDefaults: z.array(z.object({ provider: z.string().required(), model: z.string().required(), effort: z.string().required() })).default([]).extra('volatile', true),
});

export function apply(ctx, config) {
  const entry = ctx.fiber.entry;
  const ns = entry?.options?.id ?? entry?.id;
  if (!ns) throw new Error('Scoped Models requires a profile entry');
  ctx.effect(() => ctx.settings.configure({ auto: false }));
  const readSettings = () => {
    const current = ctx.fiber.effectiveConfig ?? ctx.fiber.config ?? config;
    const get = key => typeof current[key]?.get === 'function' ? current[key].get() : current[key];
    return normalizeSettings({ enabled: get('enabled') ?? true, models: get('models') ?? [], reasoningDefaults: get('reasoningDefaults') ?? [] });
  };
  const notify = () => typeof ctx.llm.emitAdaptersUpdated === 'function' ? ctx.llm.emitAdaptersUpdated() : ctx.emit('llm/adapters-updated');
  let catalog;
  ctx.effect(() => {
    const dispose = wrapReasoningDefaults(ctx.llm, readSettings);
    return () => { dispose(); notify(); };
  });
  ctx.effect(() => {
    catalog = wrapCatalog(ctx.sessionController, readSettings);
    notify();
    return () => { catalog.dispose(); notify(); };
  });
  const descriptor = () => ctx.settings.describe().find(item => item.ns === ns);
  let pending = Promise.resolve();
  const operations = {
    async read(query = '') {
      const full = await catalog.full();
      const settings = readSettings();
      const filtered = await catalog.current();
      const needle = query.toLowerCase().trim();
      const groups = scopeGroups(full.groups);
      const available = new Set(groups.flatMap(group => group.models.map(model => modelKey(group.id, model.id))));
      return {
        settings, revision: descriptor()?.revision,
        groups: groups.map(group => ({ ...group, models: group.models.filter(model => !needle || `${group.id} ${group.name} ${model.id} ${model.name}`.toLowerCase().includes(needle)) })).filter(group => group.models.length),
        failures: full.failures,
        total: groups.reduce((n, group) => n + group.models.length, 0),
        visible: filtered.groups.reduce((n, group) => n + group.models.length, 0),
        missing: settings.models.filter(pair => !available.has(modelKey(pair.provider, pair.model))),
      };
    },
    async update(input, expectedRevision) {
      const validated = normalizeSettings(input);
      const task = pending.then(async () => {
        const previousSettings = readSettings();
        // Older clients may update only the filter; omitted defaults are preserved.
        const next = { ...validated, reasoningDefaults: validated.reasoningDefaults ?? previousSettings.reasoningDefaults };
        const full = await catalog.full();
        // Existing unavailable selections may survive sign-out; do not silently remove them.
        const previous = new Set(readSettings().models.map(pair => modelKey(pair.provider, pair.model)));
        const available = new Set(full.groups.flatMap(group => group.models.map(model => modelKey(group.id, model.id))));
        if (next.models.some(pair => !previous.has(modelKey(pair.provider, pair.model)) && !available.has(modelKey(pair.provider, pair.model)))) throw new Error('A newly selected model is unavailable; refresh the catalog');
        const previousDefaults = new Map(previousSettings.reasoningDefaults.map(item => [modelKey(item.provider, item.model), item.effort]));
        const capabilities = new Map(scopeGroups(full.groups).flatMap(group => group.models.map(model => [modelKey(group.id, model.id), model.reasoning?.efforts ?? []])));
        for (const item of next.reasoningDefaults) {
          const key = modelKey(item.provider, item.model);
          if (!capabilities.get(key)?.some(effort => effort.id === item.effort) && previousDefaults.get(key) !== item.effort) throw new Error(`Unsupported default reasoning effort for ${item.provider} / ${item.model}; refresh the catalog`);
        }
        await ctx.settings.update(ns, next, expectedRevision);
        notify();
        return { settings: readSettings(), revision: descriptor()?.revision };
      });
      pending = task.catch(() => {});
      return task;
    },
  };
  ctx.provide('scopedModels', operations);
  for (const action of ['read', 'update']) {
    const method = `scoped-models/${action}`;
    ctx.effect(() => ctx.connection.fetch.register({
      path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return new Response('Expected application/json', { status: 415 });
        let envelope;
        try { envelope = clientRequestSchema.parse(await request.json()); }
        catch { return new Response('Invalid RPC envelope', { status: 400 }); }
        if (envelope.method !== method) return new Response('Wrong endpoint', { status: 400 });
        let result;
        try {
          request.signal.throwIfAborted();
          const input = envelope.payload;
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an object');
          const value = action === 'read' ? await operations.read(typeof input.query === 'string' ? input.query : '') : await operations.update(input.settings, input.revision);
          result = { ok: true, value };
        } catch (error) {
          result = { ok: false, error: { code: 'scoped-models/rejected', message: error.message, details: {} } };
        }
        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
      },
    }));
  }
  ctx.effect(() => ctx.tools.register({
    name: 'scoped_models',
    description: 'List/search models, manage native picker scope and per-model default reasoning levels. Explicit session reasoning selections take priority; provider routes are unchanged.',
    parameters: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['list', 'set'], description: 'list returns the scope and matching full-catalog models; set replaces the saved scope.' },
        query: { type: 'string', description: 'Case-insensitive name, provider, or model-ID search for list.' },
        enabled: { type: 'boolean', description: 'For set: true shows only selected models (the default); an empty selection shows no models. false is a compatibility escape hatch that restores the full native list.' },
        models: { type: 'array', description: 'For set: complete selected provider/model pairs, using IDs from list. The codex scope applies to all codex-* accounts.', items: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } }, required: ['provider', 'model'], additionalProperties: false } },
        reasoningDefaults: { type: 'array', description: 'For set: replace per-model defaults using supported effort IDs from list. Omit to preserve, [] to reset. Applies even when filtering is off; codex is shared by codex-* accounts.', items: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' } }, required: ['provider', 'model', 'effort'], additionalProperties: false } },
        revision: { type: 'number', description: 'For set: revision from list to refuse a stale edit.' },
      }, required: ['action'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if (args.action === 'set') return operations.update({ enabled: args.enabled, models: args.models, ...(args.reasoningDefaults === undefined ? {} : { reasoningDefaults: args.reasoningDefaults }) }, args.revision);
      if (args.action !== 'list') throw new Error('Unknown action');
      const result = await operations.read(args.query ?? '');
      const models = result.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id, name: model.name, ...(model.reasoning ? { reasoning: model.reasoning } : {}) })));
      const { groups, ...summary } = result;
      return { ...summary, models: models.slice(0, 100), matched: models.length, truncated: models.length > 100 };
    },
  }));
}
