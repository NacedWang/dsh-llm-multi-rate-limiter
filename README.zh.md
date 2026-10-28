# @naced/llm-multi-rate-limiter

[![npm version](https://img.shields.io/npm/v/@naced/llm-multi-rate-limiter.svg)](https://www.npmjs.com/package/@naced/llm-multi-rate-limiter)
[![npm downloads](https://img.shields.io/npm/dm/@naced/llm-multi-rate-limiter.svg)](https://www.npmjs.com/package/@naced/llm-multi-rate-limiter)
[![license](https://img.shields.io/npm/l/@naced/llm-multi-rate-limiter.svg)](LICENSE)
[![ci](https://github.com/NacedWang/dsh-llm-multi-rate-limiter/actions/workflows/ci.yml/badge.svg)](https://github.com/NacedWang/dsh-llm-multi-rate-limiter/actions/workflows/ci.yml)

按 **provider/model** 限制 LLM 请求频率的 DeepSeek Harness 插件，带一个可编辑的「设置」页（Settings → 多模型限速）、侧边栏入口，以及实时状态面板。

本包 fork 自 [`@leaf233/dsh-llm-rate-limiter`](https://github.com/Leafyezi233/dsh-llm-rate-limiter) 0.3.0（MIT，版权归上游作者），主要改动是把配置界面从「内置插件配置」卡片改为 `settings.section` 设置页 + 侧边栏入口，并移除了卡片入口。

## 功能

- **两种限速策略**：令牌桶 `token-bucket`（允许突发）／滑动窗口 `sliding-window`（严格每分钟 N 次）。
- **三层配置**：`models`（精确或通配符 key）> `providers`（整个 provider 一个上限）> `defaults`。
- **通配符 key**：`openai/*` 覆盖该 provider 下所有没有单独配置的模型，`*` 只在单段内匹配、不跨 `/`。
- **按模型独立配置**：key 为 `provider/model`，例如 `openai/gpt-5.1`。
- **429 自适应降速**：provider 返回 429 时，该模型自动按 `factor` 降速并保持 `cooldownMs`，连续 `recoverAfter` 次成功后恢复。
- **排队或拒绝**：`onThrottled: queue` 时请求等待空位（受 `maxQueueWaitMs` 约束），`reject` 时立即返回错误。
- **实时面板**：每秒拉取 `/llm-multi-rate-limiter` 状态通道，显示各模型当前令牌/窗口占用、累计放行、平均等待，以及最近事件。
- **设置页**：模型搜索过滤、删除二次确认、整份配置的 JSON 导入/导出。

## 配置

配置写在 profile 的 `cordis.patch.yml`（`~/.dsh/profiles/desktop/cordis.patch.yml`）：

```yaml
- id: llm-multi-rate-limiter
  name: "@naced/llm-multi-rate-limiter"
  config:
    enabled: true
    strategy: sliding-window
    defaults:
      maxConcurrent: 5
      maxRpm: 60
      burstSize: 10
      refillRate: 1
    providers:
      openai:
        maxRpm: 30
        maxConcurrent: 3
    models:
      openai/gpt-5.1:
        maxRpm: 20
        maxConcurrent: 2
      "azure/*":
        maxRpm: 40
    cooldown:
      enabled: true
      cooldownMs: 30000
      factor: 0.5
      recoverAfter: 3
    onThrottled: queue
    maxQueueWaitMs: 240000
```

- 行 `id` 同时是设置命名空间（`dsh-settings` 按 `entry.options.id` 建表单），改名需与 `cordis.patch.yml` 一致。
- 优先级：`models` 精确 key > `models` 里最具体的通配符 > `providers[<provider>]` > `defaults`。
- `models[<key>]` 只写需要覆盖的字段，其余逐层继承。
- 令牌桶下 `refillRate`（个/秒）若省略，会按 `maxRpm / 60` 推导。

设置页里改任何字段都会立即写回 `cordis.patch.yml` 并热生效（`dsh-hmr` 监听 profile patch）。

## 安装

走 npm registry（推荐）：

1. 在 DSH profile 的 `package.json`（`~/.dsh/profiles/desktop/package.json`）里加依赖：
   ```json
   "@naced/llm-multi-rate-limiter": "^0.1.2"
   ```
   然后在 profile 目录执行 `pnpm install`（或用 DSH 插件管理器的安装动作）。
2. `dsh.profile.bundles` 列表中加入 `"@naced/llm-multi-rate-limiter"`。
3. 在 `cordis.patch.yml` 加上面那段配置，重启 DSH。

本地开发时把依赖改成指向目录：`"@naced/llm-multi-rate-limiter": "file:./packages/llm-multi-rate-limiter"`，`bundles` 一项保持不变。

## 卸载

删除 `cordis.patch.yml` 中该行与 `bundles` 里的包名，再删 `node_modules/@naced/llm-multi-rate-limiter` 即可。

## 安全说明

本插件拦截 `llm/stream` 瀑布，位于每一次模型调用之前。它到底用这个位置做了什么：

- 只读 `options.provider`、`options.model`、`options.signal`；不检查、不记录、不外发 prompt、messages、响应或凭据。
- 不发起任何对外网络请求。唯一的 HTTP 面是自带状态通道 `/llm-multi-rate-limiter`，由 `connection.requestRejection()` 加鉴权栅栏，只接受 `POST` + `application/json`，返回的是计数器与 `provider/model` 键，不含对话内容。
- 不使用 `fs`、`child_process`、`eval`；配置写入走宿主 settings 服务。
- 没有安装脚本。

限速器自身抛错时会原样放行请求，而不是让调用失败——这里的 bug 不会把助手整体弄挂。

## 开发

```bash
git clone https://github.com/NacedWang/dsh-llm-multi-rate-limiter.git
cd dsh-llm-multi-rate-limiter
npm install
npm run check     # 语法检查 + ESLint + node:test
npm pack --dry-run
```

没有编译步骤：`lib/` 是手写的 ESM 加一份浏览器 bundle，原样发布，所以线上跑的就是这份代码。

## 发版

1. 改 `version`，在 `CHANGELOG.md` 补一条。
2. `git commit -am "chore: release vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags`
3. [`publish`](.github/workflows/publish.yml) 工作流通过 **Trusted Publishing (OIDC)** 发布到 npm —— 仓库里不存在 `NPM_TOKEN` 密钥 —— 并自动创建对应的 GitHub Release。

因为发布权限绑定了本仓库，npm 的 Trusted Publisher 设置里工作流文件名必须保持 `publish.yml`。

## License

MIT。基于 `@leaf233/dsh-llm-rate-limiter`，双版权行见 [LICENSE](LICENSE)。
