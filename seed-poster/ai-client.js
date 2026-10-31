export class ClientError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}
export function createClient({url, secret}) {
  let endpoint; try { endpoint = new URL(url); } catch { throw Error('请填写有效的 Cloudflare Worker HTTPS 地址'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw Error('Worker 地址只能包含 HTTPS 域名，不能包含路径、账号或查询参数');
  if (typeof secret !== 'string' || secret.length < 24) throw Error('请填写至少 24 位的 Worker 访问口令（不是模型 API Key）');
  return {url: endpoint.origin, async request(path, data, {signal, timeoutMs = 55000} = {}) {
    const controller = new AbortController(); let expired = false;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, {once:true}); if (signal?.aborted) abort();
    const timer = setTimeout(() => {expired = true; controller.abort();}, timeoutMs);
    try {
      const response = await fetch(endpoint.origin + path, {
        method: data === undefined ? 'GET' : 'POST', credentials:'omit', redirect:'error', cache:'no-store', signal:controller.signal,
        headers:{'Content-Type':'application/json','X-Access-Code':secret},
        ...(data === undefined ? {} : {body:JSON.stringify(data)})
      });
      if (response.ok && (response.headers.get('content-type') || '').startsWith('image/')) return await response.blob();
      let value; try {value = await response.json();}
      catch {throw new ClientError('Worker 未返回 JSON，请检查地址、部署状态或网关错误（HTTP '+response.status+'）',response.status,'RESPONSE_FORMAT');}
      if (!response.ok) throw new ClientError(value?.error || '请求失败（HTTP '+response.status+'）',response.status,value?.code);
      if (!value || typeof value !== 'object') throw new ClientError('Worker 返回格式不兼容',502,'RESPONSE_FORMAT');
      return value;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('已停止本地等待','AbortError');
      if (expired) throw new ClientError('请求超时；任务可能已创建，请先查看服务商任务记录，避免重复提交',504,'REQUEST_TIMEOUT');
      if (error instanceof ClientError) throw error;
      throw new ClientError('无法连接 Worker，请检查 HTTPS 地址、网络和 ALLOWED_ORIGIN；提交后断线请先查看服务商任务记录',0,'NETWORK');
    } finally {clearTimeout(timer); signal?.removeEventListener('abort',abort);}
  }};
}
export function wait(ms, signal) {
  return new Promise((resolve,reject) => {
    const abort = () => {clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('已停止本地等待','AbortError'));};
    const timer = setTimeout(() => {signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
export async function pollImageTask(client, task, {signal, onProgress = () => {}, sleep = wait, now = Date.now, maxMs = 10*60*1000} = {}) {
  const start = now(); let errors = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('已停止本地等待','AbortError');
    if (now()-start >= maxMs) throw new ClientError('已等待 10 分钟，任务仍可能在生成；点击“继续查询”恢复，不会重复提交',408,'POLL_TIMEOUT');
    let value;
    try {value = await client.request('/api/image-status',{task_token:task.task_token},{signal,timeoutMs:Math.min(55000,maxMs-(now()-start))}); errors = 0;}
    catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      const retryable = error instanceof ClientError && (error.status === 429 || error.status >= 500 || error.code === 'NETWORK') && error.code !== 'RESPONSE_FORMAT';
      if (!retryable || errors >= 3) throw error;
      errors++; onProgress({state:'retrying',retry:errors});await sleep(4000*errors,signal);continue;
    }
    onProgress(value);
    if (value.state === 'failed' || (value.is_final && value.state !== 'success')) throw new ClientError(value.error || '任务已终止，请查看服务商记录',422,'TASK_FAILED');
    if (value.state === 'success') {
      if (!value.result_ready) throw new ClientError('任务已完成但尚无图片链接，请稍后继续查询',502,'RESULT_MISSING');
      return value;
    }
    await sleep(4000,signal);
  }
}
