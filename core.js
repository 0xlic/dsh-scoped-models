// Model scope and default controls. Never alter routing or persisted session selections.
export const scopeProvider = provider => provider.startsWith('codex-') ? 'codex' : provider;
export const modelKey = (provider, model) => JSON.stringify([scopeProvider(provider), model]);

// Only the management view is grouped. Native catalogs retain real account IDs.
export function scopeGroups(groups) {
  const result = new Map();
  for (const group of groups) {
    const id = scopeProvider(group.id);
    if (id !== 'codex') {
      result.set(id, group);
      continue;
    }
    if (!result.has(id)) result.set(id, { ...group, id, name: 'Codex', models: [] });
    const merged = result.get(id);
    const seen = new Set(merged.models.map(model => model.id));
    for (const model of group.models) {
      if (!seen.has(model.id)) { merged.models.push(model); seen.add(model.id); }
      else if (model.reasoning?.efforts?.length) {
        const index = merged.models.findIndex(item => item.id === model.id);
        const previous = merged.models[index];
        const efforts = new Map((previous.reasoning?.efforts ?? []).map(effort => [effort.id, effort]));
        for (const effort of model.reasoning.efforts) if (!efforts.has(effort.id)) efforts.set(effort.id, effort);
        merged.models[index] = { ...previous, reasoning: { ...previous.reasoning, efforts: [...efforts.values()] } };
      }
    }
  }
  return [...result.values()];
}

export function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object');
  if (Object.keys(value).some(key => !['enabled', 'models', 'reasoningDefaults'].includes(key))) throw new Error('Unknown setting');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  if (!Array.isArray(value.models) || value.models.length > 5000) throw new Error('models must be an array of at most 5000 model pairs');
  const seen = new Set();
  const models = value.models.map(pair => {
    if (!pair || typeof pair !== 'object' || Array.isArray(pair) || Object.keys(pair).some(key => !['provider', 'model'].includes(key))) throw new Error('Invalid model pair');
    for (const key of ['provider', 'model']) {
      if (typeof pair[key] !== 'string' || !pair[key].trim() || pair[key].length > 1024) throw new Error(`Invalid ${key}`);
    }
    return { provider: scopeProvider(pair.provider), model: pair.model };
  }).filter(pair => {
    const key = modelKey(pair.provider, pair.model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const result = { enabled: value.enabled, models };
  if (value.reasoningDefaults !== undefined) {
    if (!Array.isArray(value.reasoningDefaults) || value.reasoningDefaults.length > 5000) throw new Error('reasoningDefaults must be an array of at most 5000 defaults');
    const defaults = new Map();
    for (const item of value.reasoningDefaults) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['provider', 'model', 'effort'].includes(key))) throw new Error('Invalid reasoning default');
      for (const key of ['provider', 'model', 'effort']) {
        if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 1024) throw new Error(`Invalid reasoning default ${key}`);
      }
      const normalized = { provider: scopeProvider(item.provider), model: item.model, effort: item.effort };
      const key = modelKey(item.provider, item.model);
      if (defaults.has(key) && defaults.get(key).effort !== item.effort) throw new Error('Conflicting reasoning defaults for the same model');
      defaults.set(key, normalized);
    }
    result.reasoningDefaults = [...defaults.values()];
  }
  return result;
}

export function applyReasoningDefault(info, settings) {
  const selected = settings.reasoningDefaults?.find(item => modelKey(item.provider, item.model) === modelKey(info.provider, info.id));
  if (!selected || !info.reasoning?.efforts.some(effort => effort.id === selected.effort)) return info;
  return { ...info, reasoning: { ...info.reasoning, defaultEffort: selected.effort } };
}

// DSH has no default-reasoning registration API. The shared normalization point
// covers catalog lookup, resolveCallConfig AND registration-bound prepareCall.
// Native validation/materialization still runs afterwards; explicit controls win.
export function wrapReasoningDefaults(llm, readSettings) {
  const target = llm[Symbol.for('cordis.original')] ?? llm;
  const descriptor = Object.getOwnPropertyDescriptor(target, 'normalizeModelInfo');
  const original = target.normalizeModelInfo;
  if (typeof original !== 'function') throw new Error('DSH normalizeModelInfo API is unavailable');
  let active = true;
  function withDefaults(...args) {
    const info = Reflect.apply(original, this, args);
    if (!active) return info;
    return applyReasoningDefault(info, readSettings());
  }
  for (const key of Reflect.ownKeys(original)) {
    if (['name', 'length', 'prototype', 'arguments', 'caller'].includes(key)) continue;
    Object.defineProperty(withDefaults, key, Object.getOwnPropertyDescriptor(original, key));
  }
  Object.defineProperty(target, 'normalizeModelInfo', { configurable: true, writable: true, value: withDefaults });
  return () => {
    active = false;
    if (target.normalizeModelInfo !== withDefaults) return;
    if (descriptor) Object.defineProperty(target, 'normalizeModelInfo', descriptor);
    else Reflect.deleteProperty(target, 'normalizeModelInfo');
  };
}

export function filterCatalog(catalog, settings) {
  if (!settings.enabled) return catalog;
  const allowed = new Set(settings.models.map(pair => modelKey(pair.provider, pair.model)));
  return {
    ...catalog,
    groups: catalog.groups.map(group => ({
      ...group,
      models: group.models.filter(model => allowed.has(modelKey(group.id, model.id))),
    })).filter(group => group.models.length > 0),
  };
}

// DSH currently has no catalog-filter registration API. Isolate the compatibility shim
// to ONE presentation method, preserve its caller/metadata, and restore its descriptor.
export function wrapCatalog(controller, readSettings) {
  const target = controller[Symbol.for('cordis.original')] ?? controller;
  const descriptor = Object.getOwnPropertyDescriptor(target, 'modelCatalog');
  const original = target.modelCatalog;
  if (typeof original !== 'function') throw new Error('DSH modelCatalog API is unavailable');
  let active = true;
  async function scopedCatalog(...args) {
    const full = await Reflect.apply(original, this, args);
    return active ? filterCatalog(full, readSettings()) : full;
  }
  // Preserve method annotations used by reflection implementations.
  for (const key of Reflect.ownKeys(original)) {
    if (['name', 'length', 'prototype', 'arguments', 'caller'].includes(key)) continue;
    Object.defineProperty(scopedCatalog, key, Object.getOwnPropertyDescriptor(original, key));
  }
  Object.defineProperty(target, 'modelCatalog', { configurable: true, writable: true, value: scopedCatalog });
  return {
    // Management reads use the service owner's dependency scope, not the plugin's
    // traceable proxy (whose ctx only admits this plugin's own inject list).
    full: () => Reflect.apply(original, target, []),
    current: () => Reflect.apply(target.modelCatalog, target, []),
    dispose() {
      active = false; // Safe even when a later wrapper has captured this function.
      if (target.modelCatalog !== scopedCatalog) return;
      if (descriptor) Object.defineProperty(target, 'modelCatalog', descriptor);
      else Reflect.deleteProperty(target, 'modelCatalog');
    },
  };
}
