import z from '@deepseek-ai/schemastery';
import { filterCatalog, modelKey, normalizeSettings, wrapCatalog } from './core.js';

// Small transport-envelope check; application payload validation stays below.
// No runtime dependency on a second copy of DSH's connection service.
const clientRequestSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'client-request' || typeof value.rpcId !== 'string' || typeof value.method !== 'string') throw new Error('Invalid RPC envelope');
    return value;
  },
};
export const name = 'scoped-models';
export const inject = ['sessionController', 'settings', 'connection', 'tools'];
export const Config = z.object({
  enabled: z.boolean().default(false).extra('volatile', true),
  models: z.array(z.object({ provider: z.string().required(), model: z.string().required() })).default([]).extra('volatile', true),
});

export function apply(ctx, config) {
  const entry = ctx.fiber.entry;
  const ns = entry?.options?.id ?? entry?.id;
  if (!ns) throw new Error('Scoped Models requires a profile entry');
  ctx.effect(() => ctx.settings.configure({ auto: false }));
  const readSettings = () => {
    const current = ctx.fiber.effectiveConfig ?? ctx.fiber.config ?? config;
    const get = key => typeof current[key]?.get === 'function' ? current[key].get() : current[key];
    return { enabled: get('enabled') ?? false, models: get('models') ?? [] };
  };
  const notify = () => ctx.emit('llm/adapters-updated');
  let catalog;
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
      return {
        settings, revision: descriptor()?.revision,
        groups: full.groups.map(group => ({ ...group, models: group.models.filter(model => !needle || `${group.id} ${group.name} ${model.id} ${model.name}`.toLowerCase().includes(needle)) })).filter(group => group.models.length),
        failures: full.failures,
        total: full.groups.reduce((n, group) => n + group.models.length, 0),
        visible: filtered.groups.reduce((n, group) => n + group.models.length, 0),
        missing: settings.models.filter(pair => !full.groups.some(group => group.id === pair.provider && group.models.some(model => model.id === pair.model))),
      };
    },
    async update(input, expectedRevision) {
      const next = normalizeSettings(input);
      const task = pending.then(async () => {
        const full = await catalog.full();
        if (next.enabled && filterCatalog(full, next).groups.length === 0) throw new Error('None of the selected models is currently available; refresh the catalog or disable filtering');
        // Existing unavailable selections may survive sign-out; do not silently remove them.
        const previous = new Set(readSettings().models.map(pair => modelKey(pair.provider, pair.model)));
        const available = new Set(full.groups.flatMap(group => group.models.map(model => modelKey(group.id, model.id))));
        if (next.models.some(pair => !previous.has(modelKey(pair.provider, pair.model)) && !available.has(modelKey(pair.provider, pair.model)))) throw new Error('A newly selected model is unavailable; refresh the catalog');
        await ctx.settings.update(ns, next, expectedRevision);
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
    description: 'List/search available models and manage which appear in native model pickers. Filtering does not change provider configuration or running sessions.',
    parameters: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['list', 'set'], description: 'list returns the scope and matching full-catalog models; set replaces the saved scope.' },
        query: { type: 'string', description: 'Case-insensitive name, provider, or model-ID search for list.' },
        enabled: { type: 'boolean', description: 'For set: false restores the full native list; true requires at least one available selected model.' },
        models: { type: 'array', description: 'For set: complete selected provider/model pairs, using IDs from list.', items: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } }, required: ['provider', 'model'], additionalProperties: false } },
        revision: { type: 'number', description: 'For set: revision from list to refuse a stale edit.' },
      }, required: ['action'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if (args.action === 'set') return operations.update({ enabled: args.enabled, models: args.models }, args.revision);
      if (args.action !== 'list') throw new Error('Unknown action');
      const result = await operations.read(args.query ?? '');
      const models = result.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id, name: model.name })));
      const { groups, ...summary } = result;
      return { ...summary, models: models.slice(0, 100), matched: models.length, truncated: models.length > 100 };
    },
  }));
}
