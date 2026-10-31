# Seed Poster：LK888 AI 部署与验收

网页入口：[种业海报工坊](https://semifrej722-ops.github.io/midnight-museum/seed-poster/)。

本次升级完成前端与 Worker 代码及模拟测试。**尚未部署或连接 Cloudflare，尚未验证真实 API 生图、实际模型权限、余额与计费。** GitHub Pages 发布成功也不等于 Worker 已可用。检查连接只报告配置是否齐全，不调用模型。

## 1. 先设置新的密钥

此前在聊天公开的 API Key 应在服务商控制台撤销并重新生成。本项目不使用、不保存这些旧值。图片与文字分别使用两个 Secret，可以属于不同服务商令牌，但两者的 API 地址都固定为 `https://api.lk888.ai/v1`。

| 名称 | Cloudflare 类型 | 值 |
| --- | --- | --- |
| IMAGE_API_KEY | **Secret** | 新的、有 tt-image-2.5 权限的生图令牌 |
| TEXT_API_KEY | **Secret** | 新的、有对话模型权限的文字令牌 |
| ACCESS_CODE | **Secret** | 独立随机口令，至少 24 位；建议密码管理器生成 32 位以上。不能用任一 API Key 代替 |
| TEXT_MODEL | Text | 文字账户实际支持的模型 ID，不能填展示名称；本项目没有猜测或替换你的文字模型 |
| ALLOWED_ORIGIN | Text | `https://semifrej722-ops.github.io`，不带路径或末尾斜杠 |
| IMAGE_RESULT_HOSTS | Text | 服务商返回图片的可信存储域名，多个域名用英文逗号分隔，仅填精确主机名，不加协议、路径或通配符 |

IMAGE_MODEL 固定为 `tt-image-2.5`，API_BASE_URL 固定为 `https://api.lk888.ai/v1`，不再读取旧的 AI_API_KEY / IMAGE_MODEL / API_BASE_URL 变量。两个新密钥必须分别配置，单独缺失时只影响对应功能。TEXT_MODEL 未配置时文案功能会明确报错。

IMAGE_RESULT_HOSTS 默认只允许 `cos.lingkeai.vip`。这是文档使用的存储域名，**不代表你的任务一定使用它**。第一次真实任务若提示 RESULT_HOST_BLOCKED，请在服务商自己的任务记录中核实实际 result_url 及重定向域名，只添加确实受信任的域名；不要取消域名限制。不要填本机、内网、IP、用户可任意控制的代理域名。

## 2. 在 Cloudflare 控制台部署（无需把密钥交给聊天）

1. 登录自己的 Cloudflare 账户，打开 **Workers & Pages → Create application → Create Worker**（部分界面显示 Create Worker / Hello World）。
2. 新建 `seed-poster-ai`，进入代码编辑器，把本目录 `worker.js` 的完整内容替换进去，保留 ES Module 的 `export default`，Deploy。
3. 打开该 Worker 的 **Settings → Variables and Secrets → Add**。按照上表添加变量，三个敏感项必须选择 **Secret**，其余选择 Text。完成后 **Deploy** 使其生效。
4. 复制该 Worker 的 HTTPS 地址，例如控制台实际显示的 `https://seed-poster-ai.<你的账户子域>.workers.dev`。不要复制示例占位地址，也不要在地址后加 /v1、/api 或 /health。
5. 打开 GitHub Pages 的海报网页，在“AI 创意助手”中填写 Worker 地址和 ACCESS_CODE，点“检查连接”。模型 API Key 永远不填到网页。
6. 配置齐全后，再分别点一次“AI 生成背景”和“AI 优化文案”，进行下方真实验收。

从 GitHub 仓库导入 Cloudflare 也可以：选择 Workers & Pages 的 Git 仓库导入，连接 GitHub 并仅授权此仓库；项目根目录用 `seed-poster`，Worker 名称 `seed-poster-ai`。不要设置把整个仓库上传为前端静态资源的构建命令。按控制台的 Workers 部署流程使用此目录的 `wrangler.toml`，部署前在 Cloudflare 设置同样的变量和 Secrets。前端继续使用原有 GitHub Pages。

## 3. 可选：在自己的终端用 Wrangler 发布

需要 Node.js 和自己的 Cloudflare 登录。进入仓库 `seed-poster` 目录后运行：

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put IMAGE_API_KEY
npx wrangler secret put TEXT_API_KEY
npx wrangler secret put ACCESS_CODE
```

每个 secret put 都会隐藏交互输入。不要把密钥写进命令参数、shell 历史、wrangler.toml、GitHub 文件或 Actions 日志。修改 `wrangler.toml` 中非敏感的 TEXT_MODEL 与 IMAGE_RESULT_HOSTS 后，再执行 `npx wrangler deploy`。本地开发的 .dev.vars / .env 已忽略，不能提交。

如使用仓库自动部署，Cloudflare 的 GitHub 授权属于你自己的 Cloudflare 账户连接，与 Codex 已连接 GitHub 是两回事。本次没有可用的 Cloudflare 连接或部署凭据，因此没有代替你创建 Worker、配置 Secrets 或运行真实生图。

## 4. 前后端协议与任务行为

- 创建：前端 POST /api/generate-image；Worker POST `https://api.lk888.ai/v1/media/generate`，请求为 model、prompt、params；params 使用标准版 flare、1K、auto 画质和当前海报比例。响应读取 data.task_id（也兼容顶层 task_id）。
- Worker 返回 HTTP 202、task_id、有效期 24 小时的 HMAC task_token。只知道上游 task_id 不能通过本 Worker 查询或代理图片；查询还需 ACCESS_CODE 与有效任务凭证。
- 查询：前端 POST /api/image-status，Worker GET `/v1/media/status?task_id=...`；兼容顶层和 data 内的状态，按 state / is_final / progress / result_url 判断。不把 result_url 当作用户可控代理参数。
- 每 4 秒顺序查询，临时网络、5xx 或限流错误最多重试 3 次；10 分钟后暂停，保留任务供“继续查询”。创建任务和文字生成不自动重试，避免重复计费。
- “停止等待”只取消本地查询，不取消服务商生成或计费。“清除任务记录”也不会取消上游任务或退款。已有任务时须先完成或清除，才能提交新任务。
- 当前任务凭证只存 sessionStorage，同一标签页刷新后可恢复；ACCESS_CODE 不保存，刷新须重新输入。关闭标签页可能丢失恢复记录，请自行保留服务商任务 ID。更换 ACCESS_CODE 会使旧任务凭证失效。
- 下载：前端 POST /api/image-result，Worker 再查任务并下载可信 HTTPS 域名的图片，逐次检查重定向。不会向 CDN 发送 API Key 或 ACCESS_CODE。最大 20MB，只接受 PNG / JPEG / WebP。浏览器将返回 Blob 解码后直接放进海报，再等待图片与字体完成后导出 PNG，避免跨域 Canvas 污染。
- 文字：POST /api/generate-copy → `/v1/chat/completions`，只用 TEXT_API_KEY；支持纯 JSON 和带 JSON 代码围栏的响应，五个字段必须完整才更新页面。原文案在失败时保留。
- POST 接口限制 12KB（包括未声明 Content-Length 的流式请求），远程 JSON 限制 1MB，远程请求有超时，错误不会透传服务商原始响应或密钥。
- CORS 仅允许 ALLOWED_ORIGIN 精确匹配；不接受通配来源。无 Origin 的终端请求仍需 ACCESS_CODE。GET /health 同样需要 X-Access-Code，直接在地址栏打开会返回鉴权错误。

ACCESS_CODE 是此私人工具的共享访问凭证；持有它的人能消费模型额度。CORS 不是身份认证。不要向所有访客公开口令；多人公开运营前应另加用户登录、按用户配额和 Cloudflare 限流规则，并在服务商设置费用上限。

## 5. 已完成的测试与真实验收清单

无需依赖安装，在 `seed-poster` 目录运行：

```sh
npm test
npm run check
```

自动化测试覆盖异步协议、独立密钥、鉴权 / CORS、流式请求大小、业务错误、任务凭证校验、状态终止、下载域名与重定向限制、文案 JSON、轮询中止 / 重试 / 超时、PNG 等待与错误处理。浏览器测试使用模拟服务商响应，已验证背景加入、文案填入、停止后刷新恢复且无重复创建、错误提示、移动端布局，以及 1080×1440 / 1080×1080 / 1080×1920 三种 PNG 实际文件尺寸。所有测试令牌都是合成数据，不能调用真实服务。

真实上线还需你在配置后确认：

1. “检查连接”显示两项配置齐全；错误口令应返回 401，其他网页来源应被拒绝。
2. 生图任务显示 ID 与进度；服务商控制台确实创建一条 tt-image-2.5 任务，并最终返回图片。
3. 点击“继续查询”不会创建第二条付费任务；失败、余额不足、权限不足应显示可理解的错误。
4. 文案真实调用你指定的 TEXT_MODEL，内容进入编辑框；最终品种数据由你核实。
5. 下载 PNG 能打开、尺寸正确，且包含 AI 背景和修改后的文字。

接口依据：[tt-image-2.5 文档](https://tyai.lk666.ai/apidoc#model/tt-image-2.5)、该文档公开模型元数据与状态字典（2026-11-01 读取）。Cloudflare 设置依据：[Secrets 官方说明](https://developers.cloudflare.com/workers/configuration/secrets/)与 [Wrangler 发布命令](https://developers.cloudflare.com/workers/wrangler/commands/workers/)。
