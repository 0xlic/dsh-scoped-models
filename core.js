// Presentation-only projection. Never alter adapters, routing, or persisted session selections.
export const modelKey = (provider, model) => JSON.stringify([provider, model]);

export function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object');
  if (Object.keys(value).some(key => !['enabled', 'models'].includes(key))) throw new Error('Unknown setting');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  if (!Array.isArray(value.models) || value.models.length > 5000) throw new Error('models must be an array of at most 5000 model pairs');
  const seen = new Set();
  const models = value.models.map(pair => {
    if (!pair || typeof pair !== 'object' || Array.isArray(pair) || Object.keys(pair).some(key => !['provider', 'model'].includes(key))) throw new Error('Invalid model pair');
    for (const key of ['provider', 'model']) {
      if (typeof pair[key] !== 'string' || !pair[key].trim() || pair[key].length > 1024) throw new Error(`Invalid ${key}`);
    }
    return { provider: pair.provider, model: pair.model };
  }).filter(pair => {
    const key = modelKey(pair.provider, pair.model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (value.enabled && models.length === 0) throw new Error('Select at least one model before enabling the filter');
  return { enabled: value.enabled, models };
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
