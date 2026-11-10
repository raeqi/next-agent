# 拾遗 · 桌面个人助手

拾遗发现你正在使用的应用，询问是否观察；只对允许的前台应用做本机 OCR，理解页面文字变化，在值得帮助时提出建议、准备结果，或按独立操作权限执行。

## 启动

需要 macOS 14+、Xcode Command Line Tools、Node 24.9+（包含 npm）与有效 API key。不需要安装或登录额外的桌面 Agent 软件。

```sh
npm ci
cp .env.example .env
# 编辑 .env，填写 SHIYI_API_KEY
npm run check:model
npm start
```

默认后台端口 18746。npm start 加载 .env 并启动原生透明桌面浮窗，无需浏览器。npm run start:headless 仅启动后台。npm run check:model 使用独立空目录测试模型，不读取桌面软件凭据。运行副本路径以脚本中的 DEST 为准；macOS 屏幕录制和辅助功能必须授权给同一运行副本。不要同时启动多个不同位置的 Shiyi。

## 应用与权限

- 新应用进入前台时询问一次「看 / 不看」，设置只显示实际发现的应用。
- 未允许的应用不读取页面。系统和敏感应用排除，闭眼或暂停会停止观察与执行。
- 观察权限不包含操作权限。操作分为关闭、单步确认、指定具名文本控件自动填写。
- 执行前复查页面快照；页面变化则拒绝旧计划。填写后重新读取文本值核对，点击结果保留为未验证，不宣称完成。
- 页面文字会交给 模型判断；OCR 在本机执行。材料目录用于只读查找，结果写入 shadow/。

## 当前能力与边界

通用页面变化建议、手动交办与页面快照、结果准备、单步 AX 操作规划与执行、操作日志。聊天承诺追踪是可选的增强解析能力，不是通用应用的准入条件。

当前不是视觉全能操作器：主要理解 OCR 文字，AX 控件支持 setValue / press；没有通用多步任务循环。自动填写和原生完整链路仍需系统权限后的真实控件测试。真实模型的建议判断和单步规划已独立测试通过。

## 代码

- native/Shiyi.swift：原生浮窗、前台应用发现、OCR、AX 桥。
- daemon/perceive.mjs：应用分类与通用感知辅助。
- daemon/main.mjs：授权、页面变化、建议、任务和 HTTP/SSE。
- daemon/actions.mjs：操作权限、快照检查、执行与验证。
- daemon/agent.mjs、bridge/harness.mjs：真实模型与 Harness 接线。
- daemon/layout.mjs：仅用于已适配聊天应用的增强解析。
- pet/：原生浮窗内的界面。
- desktop/、workspace-seed/：历史「林夏的一天」剧本演示，不代表真实后台能力。
- scripts/sim-chat.mjs、sim-wechat.mjs：聊天专项测试工具。

PRD 与架构位于 docs/proactive-agent/；其中早期微信 M2 和剧本场景为历史阶段设计，当前行为以实际实现及上述边界为准。

## 可复现运行依赖

官方 SDK 和匹配运行时由 package.json 固定版本，package-lock.json 固定依赖树。运行时是安装依赖，不需要把上游源码复制进仓库。凭据由 .env 的 SHIYI_API_KEY 提供；轻量与主模型可通过 SHIYI_TRIAGE_MODEL / SHIYI_DRAFT_MODEL 设置。目前只配置默认官方供应商，尚不提供任意网关切换。运行时配置独立保存在 SHIYI_HOME/runtime，默认 ~/.shiyi/runtime，不沿用桌面版配置。请勿提交 .env。首次安装需要网络；运行时部分功能还可能需要 pnpm。
