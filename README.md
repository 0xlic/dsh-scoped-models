# DSH Scoped Models · 模型范围

像 pi 的 scoped-models 一样，勾选常用模型，让 DSH **原生模型选择列表**只显示这些模型，而不是增加一个替代选择器。

## 使用

1. 安装并启用本目录的插件包。
2. 打开 **设置 → 模型范围**。
3. 搜索模型名称、ID 或提供商，勾选常用模型（可按提供商筛选、批量选中搜索结果）。
4. 打开「仅显示已选模型」，点击「保存范围」。
5. 关闭设置，使用输入框原生模型选择器或 `/model`。

关闭开关并保存即可恢复完整列表，已勾选的模型会保留。默认不开启过滤，不会替你决定常用模型。配置按当前 DSH profile 保存，刷新、重启后保留，并作用于该 profile 的会话。

## Codex 订阅与动态模型

读取 DSH 当前运行时的完整 `sessionController.modelCatalog()`，不是内置模型表。`dsh-codex-subscription` 注册的 `openai-codex` 模型会和 OpenRouter 等模型一起显示，可按 `(provider, model)` 精确选择。不同提供商的同名模型不会混淆。

保留 Codex 插件自己的选择器、推理档位、Fast 等控件，只投影它所读取的原生目录。已被 Codex 插件自身「隐藏模型」移除的条目不会被强行恢复。退出账号后已选项会保留为暂不可用，恢复账号目录后再次可见；新增模型需要重新勾选，不会自动挤入常用列表。

## 边界与兼容性

- 不改 API Key、不改提供商、不卸载模型、不修改 session 的已存选择，也不包装 `llm.listModels`、`resolveModel` 或模型请求。
- 已有会话中未勾选的模型仍可执行；因原生 UI 只在当前目录中查名称，未勾选的当前模型可能显示为「选择模型」，切换到勾选模型后正常显示。
- 所选模型全部暂不可用时，原生目录可为空；在设置里关闭过滤、重新登录账号或选择可用模型即可。保存时拒绝开启空范围。
- Settings 的 revision 冲突会明确报错。刷新模型目录保留未保存的勾选，需再次保存才生效。
- 当前 DSH **没有公开的 catalog-filter 注册接口**，本插件将兼容桥限制在 `sessionController.modelCatalog` 一个展示方法，保留原始完整目录供管理页使用。卸载/禁用时恢复原 descriptor；若后来有插件包装同一方法，不覆盖它，而把已捕获的旧过滤器转为透传。
- 当前运行环境：DSH `0.2.1-rc.5`、Codex Subscription `3.2.5`。升级 DSH 后若目录接口变更需重新验证；不复制或替换 DSH 的 UI 包。

## Agent 工具

`scoped_models` 与设置页共用 Host 操作：

- `action: "list"`，可选 `query`：返回完整目录的匹配项（最多 100 个）、保存范围及 revision。
- `action: "set"`：传入 `enabled`、完整的 `models: [{provider, model}]` 及读取时的 `revision`。

工具返回的 `truncated` 为 true 时用更具体的 query 缩小查询。设置操作只影响模型列表，不是权限控制。

## 开发与安装

```sh
pnpm install --ignore-scripts
node --test tests/*.test.js
node --check index.js
node --check client.js
```

### 本次验收

- 17 项核心/Host 集成测试通过，包括 UI RPC 与工具共用操作、revision 冲突、动态目录、精确提供商匹配和卸载恢复。
- 当前运行中的真实目录：415 个模型，其中 Codex 订阅提供 9 个。通过工具临时启用 Codex 与 OpenRouter 两个模型，原生 Host 目录从 415 收缩到 2；关闭后恢复 415。
- 测试后已恢复 `enabled: false, models: []`，没有替用户保存常用模型。
- 插件应用状态为 `applied`，无警告；设置页 `scoped-models` 已在现有 GUI 的 live Slot 注册。图标/中英文资源已检查。
- 当前会话没有浏览器点击/截图控制，实际页面布局、明暗主题与点击保存的视觉验收仍待用户确认；未将 Slot 注册当作视觉成功。

在 DSH 插件管理器中，以本目录的绝对路径安装本地包。不要手改 profile 文件。本地安装链接工作区，保持本目录存在；更新已安装的 JavaScript 代码后按 DSH 提示重新加载/重启，不能假设桌面端有开发 watcher。

图标为本包原创 SVG；代码采用 MIT 许可证。
