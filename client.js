window.__ModuleLoader__.load({
  id: 'dsh-scoped-models',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const en = {
      title: 'Model scope', intro: 'Filter frequently used models and set their default reasoning levels.',
      search: 'Search name, model ID or provider…', all: 'All providers', selectedOnly: 'Selected only', selectVisible: 'Select results', clearVisible: 'Deselect results',
      retry: 'Retry save', saving: 'Saving…', saved: 'Saved', saveFailed: 'Not saved', refresh: 'Refresh catalog', loading: 'Loading models…',
      count: 'Selected', total: 'Available',
      empty: 'No matching models.', unavailable: 'Unavailable selections',
      remove: 'Remove', error: 'Could not load or save. Please try again.',
      failures: 'Some providers could not be loaded',
      reasoning: 'Default reasoning level', providerDefault: 'Provider default', unavailableEffort: 'Unavailable', unavailableDefaults: 'Unavailable model defaults',
    };
    const zh = {
      title: '模型范围', intro: '筛选常用模型和设置模型的默认思考等级',
      search: '搜索名称、模型 ID 或提供商…', all: '全部提供商', selectedOnly: '只看已选', selectVisible: '选中搜索结果', clearVisible: '取消选中结果',
      retry: '重试保存', saving: '正在保存…', saved: '已保存', saveFailed: '未保存', refresh: '刷新模型目录', loading: '正在加载模型…',
      count: '已选', total: '可用',
      empty: '没有匹配的模型。', unavailable: '暂不可用的已选模型',
      remove: '移除', error: '加载或保存失败，请重试。',
      failures: '部分提供商加载失败',
      reasoning: '默认思考等级', providerDefault: '跟随提供商默认', unavailableEffort: '暂不可用', unavailableDefaults: '暂不可用的模型默认值',
    };
    const keyOf = (provider, model) => JSON.stringify([provider, model]);
    const css = `
      .dsh-scope {color:var(--dsw-alias-label-primary);font:inherit;max-width:800px;}
      .dsh-scope * {box-sizing:border-box;}
      .dsh-scope h2 {font-size:20px;font-weight:600;margin:0 0 10px;}
      .dsh-scope p {color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;margin:6px 0 16px;}
      .dsh-scope .scope-card {border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;margin:18px 0;}
      .dsh-scope .scope-line {display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
      .dsh-scope .scope-line.spread {justify-content:space-between;}
      .dsh-scope label {cursor:pointer;}
      .dsh-scope input[type=checkbox] {accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px;flex-shrink:0;}
      .dsh-scope button,.dsh-scope select,.dsh-scope input[type=search] {font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:8px;padding:8px 12px;}
      .dsh-scope button {cursor:pointer;}
      .dsh-scope button:hover:not(:disabled) {background:var(--dsw-alias-bg-layer-2);}
      .dsh-scope button:disabled {opacity:.5;cursor:default;}
      .dsh-scope :focus-visible {outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
      .dsh-scope input[type=search] {flex:1;min-width:160px;}
      .dsh-scope input::placeholder {color:var(--dsw-alias-label-secondary);}
      .dsh-scope .scope-meta {font-size:12px;color:var(--dsw-alias-label-secondary);}
      .dsh-scope .scope-toolbar {display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center;}
      .dsh-scope .scope-list {border:1px solid var(--dsw-alias-border-l1);border-radius:10px;max-height:480px;overflow:auto;overscroll-behavior:contain;}
      .dsh-scope .scope-group {display:grid;grid-template-columns:minmax(160px,1fr) 190px;min-width:390px;align-items:center;gap:12px;font-size:12px;font-weight:600;padding:10px 14px;position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1;}
      .dsh-scope .scope-reasoning-heading {width:190px;max-width:100%;flex-shrink:0;}
      .dsh-scope .scope-row {display:grid;grid-template-columns:minmax(160px,1fr) 190px;min-width:390px;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);}
      .dsh-scope .scope-row:hover {background:var(--dsw-alias-bg-layer-2);}
      .dsh-scope .scope-model {display:flex;align-items:center;gap:12px;flex:1;min-width:160px;}
      .dsh-scope .scope-reasoning {width:190px;max-width:100%;}
      .dsh-scope .scope-reasoning select {width:100%;}
      .dsh-scope .scope-missing-row {margin-top:12px;}
      .dsh-scope .scope-name {font-size:13px;overflow-wrap:anywhere;}
      .dsh-scope .scope-id {font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin-top:3px;}
      .dsh-scope .scope-message {font-size:13px;line-height:1.5;margin:12px 0;overflow-wrap:anywhere;}
      .dsh-scope .scope-error {color:var(--dsw-alias-state-error-primary);}
      .dsh-scope .scope-success {color:var(--dsw-alias-state-success-primary);}
      .dsh-scope .scope-empty {padding:24px;text-align:center;color:var(--dsw-alias-label-secondary);}
    `;
    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('scoped-models', { en, zh }));
        const t = ctx.locale.bind('scoped-models');
        const call = async (action, payload, signal) => {
          const result = await ctx.connection.rpc.call('/api', `scoped-models/${action}`, payload, signal);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        };
        function ScopeSettings() {
          React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot());
          const [data, setData] = React.useState(null);
          const [selected, setSelected] = React.useState(new Map());
          const [reasoningDefaults, setReasoningDefaults] = React.useState(new Map());
          const [query, setQuery] = React.useState('');
          const [provider, setProvider] = React.useState('');
          const [onlySelected, setOnlySelected] = React.useState(false);
          const [busy, setBusy] = React.useState(true);
          const [error, setError] = React.useState('');
          const [saveError, setSaveError] = React.useState('');
          const [saveStatus, setSaveStatus] = React.useState('');
          const session = React.useRef(null);
          const active = state => session.current === state && !state.abort.signal.aborted;
          // Draft maps are authoritative immediately, including edits made before a render.
          // One writer snapshots the latest version; acknowledgements advance only the
          // revision/saved version, never replace the current draft with server settings.
          const drain = state => {
            if (state.flight) return state.flight;
            if (!state.ready || state.failed || state.saved === state.version) return Promise.resolve();
            state.flight = (async () => {
              // Closing settings detaches the UI, not the already-authorized writes.
              // Finish queued edits without mutating an unmounted component.
              while (!state.failed && state.saved !== state.version) {
                const version = state.version;
                const settings = { enabled: true, models: [...state.selected.values()], reasoningDefaults: [...state.defaults.values()] };
                if (active(state)) setSaveStatus('saving');
                try {
                  const result = await call('update', { settings, revision: state.revision });
                  state.revision = result.revision;
                  state.saved = version;
                  if (active(state) && state.saved === state.version) setSaveStatus('saved');
                } catch (err) {
                  // Pause until explicit retry; retain all edits, even after a failure.
                  state.failed = true;
                  if (active(state)) {
                    setSaveError(err.message || t('error'));
                    setSaveStatus('saveFailed');
                  }
                }
              }
            })().finally(() => { state.flight = null; });
            return state.flight;
          };
          const schedule = state => {
            if (!active(state) || !state.ready || state.failed || state.refreshing) return;
            setSaveStatus('saving');
            drain(state);
          };
          const load = async (state, preserveDraft = false) => {
            if (!active(state) || state.refreshing) return;
            state.refreshing = true;
            setBusy(true); setError('');
            try {
              // Reads never overlap writes. Refresh flushes pending edits first, and
              // preserves a failed/unsaved draft rather than reinstalling settings.
              if (preserveDraft) await drain(state);
              if (!active(state)) return;
              const value = await call('read', {}, state.abort.signal);
              if (!active(state)) return;
              state.revision = value.revision;
              if (!preserveDraft) {
                state.selected = new Map(value.settings.models.map(pair => [keyOf(pair.provider, pair.model), pair]));
                state.defaults = new Map((value.settings.reasoningDefaults ?? []).map(entry => [keyOf(entry.provider, entry.model), entry]));
                state.ready = true;
                // Migrate legacy disabled scopes, including intentionally empty ones.
                state.version = value.settings.enabled === false ? 1 : 0;
                state.saved = 0;
                setSelected(state.selected);
                setReasoningDefaults(state.defaults);
                setSaveStatus(state.version ? 'saving' : 'saved');
              }
              setData(value);
            } catch (err) {
              if (active(state)) setError(err.message || t('error'));
            } finally {
              if (active(state)) {
                state.refreshing = false;
                setBusy(false);
                if (state.ready && state.saved !== state.version && !state.failed) schedule(state);
              }
            }
          };
          React.useEffect(() => {
            const state = { abort: new AbortController(), selected: new Map(), defaults: new Map(), ready: false, refreshing: false, failed: false, version: 0, saved: 0, flight: null };
            session.current = state;
            load(state);
            return () => { state.abort.abort(); };
          }, []);
          const editDraft = (models, defaults) => {
            const state = session.current;
            if (!state?.ready || state.refreshing || !active(state)) return;
            state.selected = models;
            state.defaults = defaults;
            ++state.version;
            setSelected(models);
            setReasoningDefaults(defaults);
            schedule(state);
          };
          const retry = () => {
            const state = session.current;
            if (!state?.ready || state.refreshing || !active(state)) return;
            state.failed = false;
            setSaveError('');
            drain(state);
          };
          const pairs = [...selected.values()];
          const needle = query.toLowerCase().trim();
          const groups = (data?.groups ?? []).filter(group => !provider || group.id === provider).map(group => ({
            ...group, models: group.models.filter(model => (!onlySelected || selected.has(keyOf(group.id, model.id))) && (!needle || `${group.name} ${group.id} ${model.name} ${model.id}`.toLowerCase().includes(needle))),
          })).filter(group => group.models.length);
          const toggle = (pair, checked) => {
            const state = session.current;
            const next = new Map(state.selected);
            if (checked) next.set(keyOf(pair.provider, pair.model), pair); else next.delete(keyOf(pair.provider, pair.model));
            editDraft(next, state.defaults);
          };
          const changeReasoning = (provider, model, effort) => {
            const state = session.current;
            if (!state?.selected.has(keyOf(provider, model))) return;
            const next = new Map(state.defaults);
            const key = keyOf(provider, model);
            if (effort) next.set(key, { provider, model, effort }); else next.delete(key);
            editDraft(state.selected, next);
          };
          const reasoningControl = (provider, model) => {
            if (!selected.has(keyOf(provider, model.id))) return null;
            const efforts = model.reasoning?.efforts ?? [];
            const effort = reasoningDefaults.get(keyOf(provider, model.id))?.effort ?? '';
            if (!efforts.length && !effort) return null;
            return h('div', { className: 'scope-reasoning' },
              h('select', { value: effort, disabled: busy, 'aria-label': `${t('reasoning')} · ${model.name}`, onChange: e => changeReasoning(provider, model.id, e.target.value) },
                h('option', { value: '' }, t('providerDefault')),
                effort && !efforts.some(option => option.id === effort) && h('option', { value: effort, disabled: true }, `${effort} · ${t('unavailableEffort')}`),
                ...efforts.map(option => h('option', { key: option.id, value: option.id }, option.name))));
          };
          const bulk = checked => {
            const state = session.current;
            const next = new Map(state.selected);
            for (const group of groups) for (const model of group.models) {
              const key = keyOf(group.id, model.id);
              if (checked) next.set(key, { provider: group.id, model: model.id }); else next.delete(key);
            }
            editDraft(next, state.defaults);
          };
          const available = new Set((data?.groups ?? []).flatMap(group => group.models.map(model => keyOf(group.id, model.id))));
          const missing = pairs.filter(pair => !available.has(keyOf(pair.provider, pair.model)));
          const missingDefaults = [...reasoningDefaults.values()].filter(entry => selected.has(keyOf(entry.provider, entry.model)) && !available.has(keyOf(entry.provider, entry.model)));
          return h('section', { className: 'dsh-scope', 'aria-busy': busy },
            h('style', null, css),
            h('h2', null, t('title')),
            h('p', null, t('intro')),
            h('div', { className: 'scope-toolbar scope-meta' },
              h('span', null, `${t('count')} ${selected.size} · ${t('total')} ${data?.total ?? '—'}`),
              saveStatus && h('span', { role: 'status', 'aria-live': 'polite', className: saveError ? 'scope-error' : saveStatus === 'saved' ? 'scope-success' : '' }, t(saveStatus)),
              saveError && h('button', { disabled: busy, onClick: retry }, t('retry'))),
            error && h('div', { role: 'alert', className: 'scope-message scope-error' }, error),
            saveError && h('div', { role: 'alert', className: 'scope-message scope-error' }, saveError),
            h('div', { className: 'scope-line' },
              h('input', { type: 'search', placeholder: t('search'), 'aria-label': t('search'), value: query, onChange: e => setQuery(e.target.value) }),
              h('select', { value: provider, 'aria-label': t('all'), onChange: e => setProvider(e.target.value) }, h('option', { value: '' }, t('all')), ...(data?.groups ?? []).map(group => h('option', { key: group.id, value: group.id }, group.name))),
              h('button', { disabled: busy, onClick: () => load(session.current, session.current.ready) }, t('refresh'))),
            h('div', { className: 'scope-toolbar' },
              h('label', { className: 'scope-line scope-meta' }, h('input', { type: 'checkbox', checked: onlySelected, onChange: e => setOnlySelected(e.target.checked) }), t('selectedOnly')),
              h('button', { disabled: busy || !groups.length, onClick: () => bulk(true) }, t('selectVisible')),
              h('button', { disabled: busy || !groups.length, onClick: () => bulk(false) }, t('clearVisible'))),
            h('div', { className: 'scope-list' },
              ...groups.map(group => h('div', { key: group.id },
                h('div', { className: 'scope-group' },
                  h('span', null, `${group.name} · ${group.models.length}`),
                  group.models.some(model => selected.has(keyOf(group.id, model.id)) && (model.reasoning?.efforts?.length || reasoningDefaults.has(keyOf(group.id, model.id)))) && h('span', { className: 'scope-meta scope-reasoning-heading' }, t('reasoning'))),
                ...group.models.map(model => h('div', { className: 'scope-row', key: model.id },
                  h('label', { className: 'scope-model' },
                    h('input', { type: 'checkbox', checked: selected.has(keyOf(group.id, model.id)), disabled: busy, onChange: e => toggle({ provider: group.id, model: model.id }, e.target.checked) }),
                    h('div', null, h('div', { className: 'scope-name' }, model.name), h('div', { className: 'scope-id' }, `${group.id} / ${model.id}`))),
                  reasoningControl(group.id, model))))),
              !groups.length && h('div', { className: 'scope-empty', role: 'status' }, t(busy ? 'loading' : 'empty'))),
            missing.length > 0 && h('div', { className: 'scope-card' },
              h('strong', null, t('unavailable')),
              ...missing.map(pair => h('div', { key: keyOf(pair.provider, pair.model), className: 'scope-line spread scope-missing-row' },
                h('span', { className: 'scope-id' }, `${pair.provider} / ${pair.model}`),
                h('button', { disabled: busy, onClick: () => toggle(pair, false), 'aria-label': `${t('remove')} ${pair.model}` }, t('remove'))))),
            missingDefaults.length > 0 && h('div', { className: 'scope-card' },
              h('strong', null, t('unavailableDefaults')),
              ...missingDefaults.map(entry => h('div', { key: keyOf(entry.provider, entry.model), className: 'scope-line spread scope-missing-row' },
                h('span', { className: 'scope-id' }, `${entry.provider} / ${entry.model}`),
                reasoningControl(entry.provider, { id: entry.model, name: entry.model })))),
            data?.failures?.length > 0 && h('details', { className: 'scope-message' }, h('summary', null, t('failures')), ...data.failures.map(failure => h('p', { key: failure.id }, `${failure.name}: ${failure.message}`))));
        }
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: 'scoped-models',
        }, ({size = 16}) => h('svg', {
          width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': true, focusable: false,
        }, h('path', {d: 'M2 2.5h12l-5 6v3.5l-2 1V8.5Z'}),
        h('path', {d: 'm10 12.5 1.5 1.5 3-3.5'}))));
        ctx.slots.inject('settings.section', () => {
          let dispose;
          const register = () => {
            dispose?.();
            dispose = ctx.slots.register({ name: 'settings.section', id: 'scoped-models', order: 12, label: () => t('title') }, ScopeSettings);
          };
          register();
          const stop = ctx.on('locale/change', register);
          return () => { stop(); dispose?.(); };
        });
      },
    };
  },
});
