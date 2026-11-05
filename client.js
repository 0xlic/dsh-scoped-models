window.__ModuleLoader__.load({
  id: 'dsh-scoped-models',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const en = {
      title: 'Model scope', intro: 'Choose the models you actually use. The native picker and /model will show only these models after you save.',
      enable: 'Show only selected models', note: 'Only the picker is filtered. Provider settings, Codex controls and existing conversations are unchanged.',
      search: 'Search name, model ID or provider…', all: 'All providers', selectedOnly: 'Selected only', selectVisible: 'Select results', clearVisible: 'Deselect results',
      save: 'Save scope', saving: 'Saving…', saved: 'Saved. Native model pickers have been updated.', refresh: 'Refresh catalog', loading: 'Loading models…',
      count: 'Selected', total: 'Available', active: 'Filtering is on', inactive: 'Filtering is off — all models are shown',
      empty: 'No matching models.', unavailable: 'Unavailable selections', missingNote: 'These models are temporarily unavailable (for example after signing out). Kept until you remove them.',
      remove: 'Remove', error: 'Could not load or save. Try refreshing.', noSelection: 'Select at least one available model before enabling filtering.',
      failures: 'Some providers could not be loaded', dirty: 'Unsaved changes',
    };
    const zh = {
      title: '模型范围', intro: '勾选真正会用到的模型。保存后，原生模型选择器和 /model 只显示这些模型。',
      enable: '仅显示已选模型', note: '只过滤选择列表，不改动提供商配置、Codex 控件或已有会话。',
      search: '搜索名称、模型 ID 或提供商…', all: '全部提供商', selectedOnly: '只看已选', selectVisible: '选中搜索结果', clearVisible: '取消选中结果',
      save: '保存范围', saving: '正在保存…', saved: '已保存，原生模型列表已更新。', refresh: '刷新模型目录', loading: '正在加载模型…',
      count: '已选', total: '可用', active: '已开启范围过滤', inactive: '未开启过滤，原生列表显示全部模型',
      empty: '没有匹配的模型。', unavailable: '暂不可用的已选模型', missingNote: '例如退出订阅账号后，这些模型会暂不可用；在你移除前会保留选择。',
      remove: '移除', error: '加载或保存失败，请刷新后重试。', noSelection: '开启过滤前，请至少选择一个当前可用的模型。',
      failures: '部分提供商加载失败', dirty: '有未保存的更改',
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
      .dsh-scope button.primary {background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);font-weight:500;}
      .dsh-scope :focus-visible {outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
      .dsh-scope input[type=search] {flex:1;min-width:160px;}
      .dsh-scope input::placeholder {color:var(--dsw-alias-label-secondary);}
      .dsh-scope .scope-meta {font-size:12px;color:var(--dsw-alias-label-secondary);}
      .dsh-scope .scope-toolbar {display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center;}
      .dsh-scope .scope-list {border:1px solid var(--dsw-alias-border-l1);border-radius:10px;max-height:480px;overflow:auto;overscroll-behavior:contain;}
      .dsh-scope .scope-group {font-size:12px;font-weight:600;padding:10px 14px;position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1;}
      .dsh-scope .scope-row {display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);}
      .dsh-scope .scope-row:hover {background:var(--dsw-alias-bg-layer-2);}
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
          const [enabled, setEnabled] = React.useState(false);
          const [selected, setSelected] = React.useState(new Map());
          const [query, setQuery] = React.useState('');
          const [provider, setProvider] = React.useState('');
          const [onlySelected, setOnlySelected] = React.useState(false);
          const [busy, setBusy] = React.useState(true);
          const [error, setError] = React.useState('');
          const [message, setMessage] = React.useState('');
          const generation = React.useRef(0);
          const mounted = React.useRef(true);
          const install = value => {
            setData(value);
            setEnabled(value.settings.enabled);
            setSelected(new Map(value.settings.models.map(pair => [keyOf(pair.provider, pair.model), pair])));
          };
          const load = async (signal, preserveDraft = false) => {
            const ticket = ++generation.current;
            setBusy(true); setError(''); setMessage('');
            try {
              const value = await call('read', {}, signal);
              if (!mounted.current || ticket !== generation.current) return;
              if (preserveDraft) setData(value); else install(value);
            } catch (err) {
              if (mounted.current && ticket === generation.current && !signal?.aborted) setError(err.message || t('error'));
            } finally {
              if (mounted.current && ticket === generation.current) setBusy(false);
            }
          };
          React.useEffect(() => {
            mounted.current = true;
            const abort = new AbortController();
            load(abort.signal);
            return () => { mounted.current = false; ++generation.current; abort.abort(); };
          }, []);
          const pairs = [...selected.values()];
          const original = data?.settings;
          const dirty = !!original && (enabled !== original.enabled || selected.size !== original.models.length || original.models.some(pair => !selected.has(keyOf(pair.provider, pair.model))));
          const needle = query.toLowerCase().trim();
          const groups = (data?.groups ?? []).filter(group => !provider || group.id === provider).map(group => ({
            ...group, models: group.models.filter(model => (!onlySelected || selected.has(keyOf(group.id, model.id))) && (!needle || `${group.name} ${group.id} ${model.name} ${model.id}`.toLowerCase().includes(needle))),
          })).filter(group => group.models.length);
          const toggle = (pair, checked) => {
            setMessage('');
            setSelected(previous => { const next = new Map(previous); if (checked) next.set(keyOf(pair.provider, pair.model), pair); else next.delete(keyOf(pair.provider, pair.model)); return next; });
          };
          const bulk = checked => {
            setMessage('');
            setSelected(previous => {
              const next = new Map(previous);
              for (const group of groups) for (const model of group.models) {
                const key = keyOf(group.id, model.id);
                if (checked) next.set(key, { provider: group.id, model: model.id }); else next.delete(key);
              }
              return next;
            });
          };
          const available = new Set((data?.groups ?? []).flatMap(group => group.models.map(model => keyOf(group.id, model.id))));
          const missing = pairs.filter(pair => !available.has(keyOf(pair.provider, pair.model)));
          const save = async () => {
            if (enabled && !pairs.some(pair => available.has(keyOf(pair.provider, pair.model)))) { setError(t('noSelection')); return; }
            const ticket = ++generation.current;
            setBusy(true); setError(''); setMessage('');
            try {
              const result = await call('update', { settings: { enabled, models: pairs }, revision: data.revision });
              if (mounted.current && ticket === generation.current) { setData(previous => ({ ...previous, ...result })); setMessage(t('saved')); }
            } catch (err) {
              if (mounted.current && ticket === generation.current) setError(err.message || t('error'));
            } finally { if (mounted.current && ticket === generation.current) setBusy(false); }
          };
          return h('section', { className: 'dsh-scope', 'aria-busy': busy },
            h('style', null, css),
            h('h2', null, t('title')),
            h('p', null, t('intro')),
            h('div', { className: 'scope-card' },
              h('div', { className: 'scope-line spread' },
                h('label', { className: 'scope-line' }, h('input', { type: 'checkbox', role: 'switch', checked: enabled, 'aria-checked': enabled, disabled: busy || !data, onChange: e => { setEnabled(e.target.checked); setMessage(''); } }), t('enable')),
                h('span', { className: 'scope-meta' }, `${t('count')} ${selected.size} · ${t('total')} ${data?.total ?? '—'}`)),
              h('p', null, t('note')),
              h('div', { className: 'scope-line spread' },
                h('span', { className: 'scope-meta' }, dirty ? t('dirty') : t(data?.settings.enabled ? 'active' : 'inactive')),
                h('button', { className: 'primary', disabled: busy || !data || !dirty, onClick: save }, t(busy && data ? 'saving' : 'save')))),
            error && h('div', { role: 'alert', className: 'scope-message scope-error' }, error),
            message && h('div', { role: 'status', className: 'scope-message scope-success' }, message),
            h('div', { className: 'scope-line' },
              h('input', { type: 'search', placeholder: t('search'), 'aria-label': t('search'), value: query, onChange: e => setQuery(e.target.value) }),
              h('select', { value: provider, 'aria-label': t('all'), onChange: e => setProvider(e.target.value) }, h('option', { value: '' }, t('all')), ...(data?.groups ?? []).map(group => h('option', { key: group.id, value: group.id }, group.name))),
              h('button', { disabled: busy, onClick: () => load(undefined, true) }, t('refresh'))),
            h('div', { className: 'scope-toolbar' },
              h('label', { className: 'scope-line scope-meta' }, h('input', { type: 'checkbox', checked: onlySelected, onChange: e => setOnlySelected(e.target.checked) }), t('selectedOnly')),
              h('button', { disabled: busy || !groups.length, onClick: () => bulk(true) }, t('selectVisible')),
              h('button', { disabled: busy || !groups.length, onClick: () => bulk(false) }, t('clearVisible'))),
            h('div', { className: 'scope-list' },
              ...groups.map(group => h('div', { key: group.id },
                h('div', { className: 'scope-group' }, `${group.name} · ${group.models.length}`),
                ...group.models.map(model => h('label', { className: 'scope-row', key: model.id },
                  h('input', { type: 'checkbox', checked: selected.has(keyOf(group.id, model.id)), disabled: busy, onChange: e => toggle({ provider: group.id, model: model.id }, e.target.checked) }),
                  h('div', null, h('div', { className: 'scope-name' }, model.name), h('div', { className: 'scope-id' }, `${group.id} / ${model.id}`)))))),
              !groups.length && h('div', { className: 'scope-empty', role: 'status' }, t(busy ? 'loading' : 'empty'))),
            missing.length > 0 && h('div', { className: 'scope-card' },
              h('strong', null, t('unavailable')), h('p', null, t('missingNote')),
              ...missing.map(pair => h('div', { key: keyOf(pair.provider, pair.model), className: 'scope-line spread' },
                h('span', { className: 'scope-id' }, `${pair.provider} / ${pair.model}`),
                h('button', { disabled: busy, onClick: () => toggle(pair, false), 'aria-label': `${t('remove')} ${pair.model}` }, t('remove'))))),
            data?.failures?.length > 0 && h('details', { className: 'scope-message' }, h('summary', null, t('failures')), ...data.failures.map(failure => h('p', { key: failure.id }, `${failure.name}: ${failure.message}`))));
        }
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
