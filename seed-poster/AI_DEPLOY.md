# 免费部署 AI 海报功能

网站：https://semifrej722-ops.github.io/midnight-museum/seed-poster/

Cloudflare → Workers & Pages → Create Worker，复制 worker.js 内容并部署。到 Settings → Variables and Secrets 配置：

- AI_API_KEY：Secret（使用新的 API 密钥；切勿写入 GitHub）
- ACCESS_CODE：Secret（单独设置的高强度访问密码，非 API 密钥）
- IMAGE_MODEL：Text（账号实际支持的图像模型 ID）
- TEXT_MODEL：Text（账号实际支持的对话模型 ID，可选）
- API_BASE_URL：Text，https://api.lk888.ai/v1
- ALLOWED_ORIGIN：Text，https://semifrej722-ops.github.io

部署后访问 Worker 的 /health 检查配置。回到海报网页“AI 创意助手”输入 Worker URL 和 ACCESS_CODE 即可。原有手动排版免费且不依赖后端。

注意：免费的是 GitHub Pages 和 Cloudflare Workers 的基础配额，生图 API 可能按张扣费。用户此前在聊天分享过密钥，请换新密钥再使用。该示例不具备完整商业限流，公开给陌生人使用前需要 Turnstile、WAF 和费用预算限制。

接口假定图像模型支持 /v1/images/generations；实际平台/模型可能不同。