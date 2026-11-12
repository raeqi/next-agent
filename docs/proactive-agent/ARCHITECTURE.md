# 拾遗：通用桌面架构

版本 v0.2 · 2026-11-11。产品范围见 PRD.md；历史设计见 archive/ARCHITECTURE-v0.1.md。

## 产品目标与触发方式

架构服务于「不用开口，也能主动干活」：以授权应用的屏幕变化为触发，串起感知、上下文理解、介入判断、准备结果与按权限执行。直接委派是补充触发源，不是主动帮助的前提。当前建议与委派执行器尚未完全统一，不代表已有通用多步桌面自主执行能力。

## 运行结构

native/Shiyi.swift 的 NSPanel + WKWebView 承载 pet/ 界面。原生端报告前台应用，按白名单截取窗口并进行本机 Vision OCR，POST /focus、/observe 给 daemon/main.mjs。界面订阅 /events SSE，向 /action 提交用户操作。

后台默认开发端口18746。scripts/start-desktop.sh 编译后把运行副本放到固定 ~/Applications/Shiyi.app，仅源码变化时重建，避免同步文件夹的扩展属性破坏签名；SHIYI_NATIVE_APP、SHIYI_NATIVE_BINARY、SHIYI_URL 指定运行副本与连接。数据默认 ~/.shiyi，SHIYI_HOME 可隔离。当前会话运行目录 /tmp/shiyi-desktop-live 为测试环境，不是正式安装方案。

## 感知与建议

store.mjs 持久化 config.apps（on/off）、discoveredApps、appNames；仅实际发现应用进入设置。perceive.mjs 分类 chat/doc/other；layout.mjs 对聊天提供增强解析，不限制其他应用感知。文档路径读取辅助函数已存在，但未接通通用观察主流程。

main.mjs 将 OCR 按阅读顺序转换为文字，写 context/<bundle>.txt，比较指纹并限频调用 agent.judgeOpportunity。pages 保存内存快照。应用前台停留定时器独立于画面变化触发询问；只对允许应用运行，受冷却与打扰预算限制。

聊天承诺仍有专项识别、起草、兑现检测逻辑；不应对通用页面作「与你要兑现的事无关」判断。通用建议使用 opportunity 卡片，准备结果调用 reviewContext，写当前 shadow 工作目录下 <id>/看法.md。

## 委派任务

/action add-task 创建任务并调用 startTask → executeTask。Harness 主模型在工具循环中执行任务，事件回传更新进度。工作目录为 shadow/，任务只应写 <id>/，不是重复写 shadow/<id>/。

产物为计划.md、结果.md、任务状态.json。宿主检查状态枚举、交付文件存在与文件名范围、验证说明；这不等于独立证明模型所有论断正确。completed/blocked 结果以 task-result 卡呈现；异常为 failed，可补充后重试。重启将遗留 running 任务标为 blocked，将 working 建议标为 failed。

委派执行器没有桌面操作工具集成，不应绕过 actions.mjs；现阶段需要桌面多步交互时返回阻塞。任务中的网络和文件边界部分依赖提示词及 Harness 沙箱，尚不是完整宿主级工具白名单。

## 原生操作与验证

actions.mjs 通过 Shiyi --inspect / --execute 读取 AX 控件或执行 setValue / press。config.operations 为 off/ask/auto，autoTargets 为允许自动填写的控件名称。

宿主复查观察状态、暂停、权限、快照摘要、控件角色和允许操作。自动操作仅允许具名文本框，密码框禁止。危险按钮标题过滤仅为有限防线，不构成通用语义安全保证。执行后读取目标角色、标题、文本值验证；press 保留 unverified。state.audit 保存最近200次执行记录。

真实AX调用仍未通过系统权限检测。CLI子进程权限归属与应用签名/位置需进一步定位，不能把模拟桥测试作为真实桌面通过证据。

## 模型与生命周期

bridge/harness.mjs 通过项目内官方 SDK 启动匹配版本运行时，使用独立配置目录与显式 API key。triage / draft 进程池各自串行排队。Flash负责判断/规划，Pro负责处理/交付。session/wait 超时180秒，超时关闭对应池；排队时间不包含在单次执行超时内。缺少可靠单任务取消和精确排队位置。

SSE重连成功清除过期断线气泡；前端静态资源需要重新加载才能更新。原生鼠标全局监听调用 window.shiyiDismiss，页面同时支持 Esc 与内部空白关闭。原生更新需重新签名，可能影响授权。

## 验证

node scripts/actions-test.mjs：隔离模拟桥8项检查，不接触实际应用。真实模型分别验证机会判断、单步规划、工具计算交叉验证和 reviewContext 文件读取；独立 npm 运行时的模型连接与工具交付已验证。完整原生权限、实际填写、外部点击关闭、定时投递桌宠仍待验证。

历史 desktop/ 和 workspace-seed/ 为剧本演示。模拟聊天脚本只覆盖聊天专项。当前状态以本文件和 PRD 的验收边界为准。

## 独立安装与凭据（v0.3）

项目通过官方 SDK 与固定版本的 npm 运行时依赖启动 Agent，不依赖预安装桌面软件、绝对安装路径或已有登录态。用户 npm ci 后可以直接 npm start。未填写 MODEL_API_KEY 或 SHIYI_API_KEY 时进入演示模式，用中文剧本走通建议和任务；要真实模型再在 .env 填写 MODEL_API_KEY、MODEL_BASE_URL 和 MODEL_NAME，然后运行 npm run check:model 并重启。运行时使用独立 SHIYI_HOME/runtime，模型凭据由显式环境变量传入；模型型号与接口地址可配置，按 OpenAI 兼容方式调用，不必声明供应商。已有 SHIYI_*、MOONSHOT_API_KEY、DEEPSEEK_API_KEY 仍可读取。源码运行需要 macOS 原生构建环境、Node 24.9+ 和 npm。真实 API 验证需要用户提供 key；模拟测试不能替代该验证。

依赖审计修复：通过 overrides 将 undici、fflate、MCP client 和 Zod 的依赖解析到修复版本；锁文件审计为0项漏洞，真实模型连接与工具交付已回归通过。

模型 key、接口地址和模型名写在本地 .env，不进入 Git。真实调用仍需对应服务凭据验证。
