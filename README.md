# 拾遗 · 一个不用吩咐的个人 Agent

> 你在微信里随口答应别人的事，它记下、提前做好，在对的时候带着草稿来找你；
> 你说一句「不对」，它就多学会一条你的做事方式。

这是一个**跑在你自己 Mac 上的 agent 应用**：
- 一只浮在所有窗口上方的桌宠；
- 一双只看微信、在本机做 OCR 的「眼睛」；
- 背后由 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 驱动的 DeepSeek agent，负责判断和起草。

产品判断与设计见 [docs/proactive-agent/PRD.md](docs/proactive-agent/PRD.md) 和 [docs/proactive-agent/ARCHITECTURE.md](docs/proactive-agent/ARCHITECTURE.md)。

---

## 它在做什么

```
微信窗口 ──截图(本机)──▶ Vision OCR(本机) ──▶ 会话名 + 谁说了什么 + 哪些是新消息
                                                        │
                       L0 本机规则：像不像一个承诺？（不花钱，绝大多数到此为止）
                                                        │
                       L1 deepseek-v4-flash：是不是要兑现的承诺？对象、事项、时间
                                                        │  记下（桌宠点头，不出声）
                       L2 deepseek-v4-pro（Harness agent）：翻聊天和你的文件夹，
                          在 ~/.shiyi/workspace/shadow/ 写好「要发的话」和文档，材料不够就写「缺什么」
                                                        │
                       在对的时候开口：离截止 4 小时内马上说，否则截止当天早上说
                                                        │
              你：复制并打开微信（最后一下由你按）/ 改一下（→ 它想想能否学成规则）/ 不用了
                                                        │
              你在微信里发出去了 → 它看到了，自动划掉
```

- **只看微信**：前台不是微信时什么都不截；私密应用在前台时桌宠闭眼；随时可以手动闭眼。
- **截图和 OCR 都在本机**，送去模型的只有识别出的文字。
- **原件永远不碰**：agent 只能写 `~/.shiyi/workspace/shadow/`，由 Harness sandbox 强制保证。
- **越用越像你**：你确认过的规则写进 `~/.shiyi/workspace/AGENTS.md`，之后每次起草都会先读。
- **18:30 下班收尾**：列出今天答应的事，标出哪些已兑现、哪些还在等你。

## 跑起来

需要：macOS 14+、Xcode Command Line Tools、Node 22+、[DeepSeek Harness 桌面版](https://github.com/deepseek-ai/deepseek-harness)（已登录或配置好 DeepSeek API key）、Mac 版微信。

```bash
sh scripts/build-native.sh        # 构建 native/build/Shiyi.app（桌宠 + 眼睛）
node daemon/main.mjs              # 启动后台，并自动打开桌宠
```

第一次运行时：
1. 桌宠会提示需要「屏幕录制」权限。点气泡打开系统设置，在「隐私与安全性 → 屏幕录制」里勾选 **Shiyi**。
2. 退出桌宠（鼠标移到桌宠上 → 退出），再重新执行一次 `node daemon/main.mjs`。
3. 打开微信，进入一个聊天。第一次看到的会话只当作历史上下文，不会触发。接着发一句「明天上午发你周报」试试。

鼠标移到桌宠上会出现菜单：**闭眼 / 今天 / 它看到了什么 / 手册 / 退出**。

配置在 `~/.shiyi/config.json`：
- `materials`：agent 可以只读查找材料的目录
- `privateApps`、`ignoreConvs`：私密应用名单、不看的会话
- `morningAt`、`wrapUpAt`：早上开口和下班收尾的时间
- `speakBudgetPerHour`：每小时最多主动开口几次
- `wechatListWidth`：会话列表宽度，自动识别不准时手动填

## 目录

```
native/Shiyi.swift      桌宠窗口 + 微信截图 + Vision OCR（原生，约 200 行）
daemon/                 后台：wechat.mjs 版式解析与去重 · agent.mjs Harness 接线与手册 · main.mjs 筛选/开口/操作/HTTP
pet/                    桌宠页面（跑在原生透明窗口里）
bridge/harness.mjs      零依赖 DeepSeek Harness SDK 客户端（stdio JSON-RPC）
scripts/                build-native.sh · sim-wechat.mjs（不开微信也能测）· pet-shots.mjs · desktop-e2e.mjs
desktop/ workspace-seed/  「林夏的一天」演示模式（给评审 5 分钟看完整故事，剧本数据）
docs/                   产品文档、框架设计、2026 趋势研究
```

## 不开微信也能测

```bash
SHIYI_HOME=/tmp/shiyi-test node daemon/main.mjs --no-pet --port 7811
node scripts/sim-wechat.mjs 7811 王建国 "other:能先给我一版竞品对比吗"
node scripts/sim-wechat.mjs 7811 王建国 "other:能先给我一版竞品对比吗" "me:好的王总，明天上午发你竞品对比"
```

第一条消息会被当作历史上下文；第二条会走完 L0 → L1 → L2 的真实链路。用浏览器打开 http://127.0.0.1:7811/pet/?view=insight 可以看到每一步。

## 演示模式

```bash
node desktop/serve.mjs            # http://127.0.0.1:7799 ，按 → 一幕一幕看「林夏的一天」
```

## 边界

- 眼睛只认 Mac 版微信，靠版式识别「谁说的」，群聊里对方的名字可能识别不准；可以在 config 里调整会话列表宽度。
- 「发」永远由你按：拾遗只复制消息、打开微信，并在访达里选中文档。
- 每次重新构建 `Shiyi.app`，macOS 会把它当成新应用，需要重新授权屏幕录制（ad-hoc 签名的限制）。
