// Cloudflare Secrets only: IMAGE_API_KEY, TEXT_API_KEY, ACCESS_CODE.
const API='https://api.lk888.ai/v1', ORIGIN='https://semifrej722-ops.github.io';
const enc=new TextEncoder(), KEYS=['headline','subline','point1','point2','point3'];
const SUCCESS=new Set(['success','succeed','succeeded','completed','finish','done']);
const FAILED=new Set(['failed','failure','error','cancelled','canceled','unknown','timeout','refunding','interrupted','violation']);
class ApiError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code}
}
const fail=(status,code,message)=>{throw new ApiError(status,code,message)};
const clean=(s,n)=>typeof s==='string'?s.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,n):'';
const json=(body,status,headers)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
async function bytesLimited(response,limit){
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();fail(413,'BODY_TOO_LARGE','内容超过大小限制')}
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit){await reader.cancel();fail(413,'BODY_TOO_LARGE','内容超过大小限制')}chunks.push(value)}}
  finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}return bytes;
}
async function parseJSON(response,limit){
  const bytes=await bytesLimited(response,limit);
  try{return JSON.parse(new TextDecoder().decode(bytes))}
  catch{fail(502,'UPSTREAM_FORMAT','服务未返回有效 JSON，请检查服务地址或稍后重试')}
}
async function timed(operation,ms=45000){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ApiError(504,'UPSTREAM_TIMEOUT','远程请求超时；提交超时不代表任务未创建，请勿连续重复提交'))},ms)});
  try{return await Promise.race([operation(controller.signal),timeout])}finally{clearTimeout(timer)}
}
async function provider(path,key,body){
  return timed(async signal=>{
    const r=await fetch(API+path,{method:body?'POST':'GET',redirect:'error',signal,headers:{authorization:'Bearer '+key,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok){
      await r.body?.cancel();
      if(r.status===429)fail(429,'UPSTREAM_RATE_LIMIT','模型服务限流，请稍后再试');
      if([401,403].includes(r.status))fail(502,'UPSTREAM_AUTH','模型服务鉴权失败，请检查对应的 Worker Secret');
      if(r.status===402)fail(502,'UPSTREAM_BALANCE','模型账户余额不足，请检查服务商账户');
      fail(502,'UPSTREAM_HTTP','模型服务请求失败（HTTP '+r.status+'），请检查模型、余额和参数');
    }
    const v=await parseJSON(r,1024*1024);
    if(!v||typeof v!=='object'||Array.isArray(v))fail(502,'UPSTREAM_FORMAT','模型返回格式不兼容');
    if(('code' in v&&![0,200,202,'0','200','202'].includes(v.code))||(v.error&&!('state' in v)&&!('data' in v)))
      fail(502,'UPSTREAM_REJECTED','模型服务返回业务错误，请检查余额、模型权限和参数');
    return v;
  });
}
async function equalSecret(a,b){
  const hashes=await Promise.all([a,b].map(s=>crypto.subtle.digest('SHA-256',enc.encode(s))));
  const x=new Uint8Array(hashes[0]),y=new Uint8Array(hashes[1]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;
}
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function unb64(s){if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error();return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}
const signingKey=secret=>crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
function validId(id){return typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id)}
async function signTask(id,secret){
  const payload=b64(enc.encode(JSON.stringify({id,expires:Date.now()+24*60*60*1000})));
  return payload+'.'+b64(await crypto.subtle.sign('HMAC',await signingKey(secret),enc.encode(payload)));
}
async function verifyTask(token,secret){
  try{
    if(typeof token!=='string'||token.length>1000)throw Error();
    const parts=token.split('.');if(parts.length!==2)throw Error();const [payload,signature]=parts;
    if(!await crypto.subtle.verify('HMAC',await signingKey(secret),unb64(signature),enc.encode(payload)))throw Error();
    const v=JSON.parse(new TextDecoder().decode(unb64(payload)));
    if(!validId(v.id)||!Number.isFinite(v.expires)||v.expires<Date.now())throw Error();return v.id;
  }catch{fail(401,'TASK_TOKEN_INVALID','任务凭证无效或已过期（24 小时），请检查访问口令是否更改')}
}
function normalizeStatus(raw){
  const d=raw.data&&typeof raw.data==='object'?raw.data:raw,state=String(d.state||'').toLowerCase();
  if(!state)fail(502,'UPSTREAM_FORMAT','任务状态缺少 state 字段');
  const success=SUCCESS.has(state),failed=FAILED.has(state)||state.endsWith('_failed')||(d.is_final===true&&!success);
  return {state:success?'success':failed?'failed':'running',is_final:success||failed||d.is_final===true,
    progress:Math.max(0,Math.min(100,parseFloat(d.progress)||(success?100:0))),
    result_ready:success&&typeof d.result_url==='string'&&!!d.result_url,
    error:failed?'任务生成失败或已终止，请在服务商任务记录中查看原因后再决定是否重试':'',
    result_url:success&&typeof d.result_url==='string'?d.result_url:''};
}
function resultURL(value,env){
  let u;try{u=new URL(value)}catch{fail(502,'RESULT_URL_INVALID','任务结果地址无效')}
  const hosts=(env.IMAGE_RESULT_HOSTS||'cos.lingkeai.vip').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!h.includes('.')||
    h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.localhost')||/^[\d.]+$/.test(h)||h.includes(':')||!hosts.includes(h))
    fail(502,'RESULT_HOST_BLOCKED','图片域名未获允许；请管理员核实服务商结果域名并加入 IMAGE_RESULT_HOSTS（包含重定向域名）');
  return u.href;
}
async function downloadResult(link,env,headers){
  return timed(async signal=>{
    let url=resultURL(link,env);
    for(let redirects=0;redirects<=3;redirects++){
      // No authorization header is sent to CDN or storage hosts.
      const r=await fetch(url,{redirect:'manual',signal,headers:{Accept:'image/png,image/jpeg,image/webp'}});
      if([301,302,303,307,308].includes(r.status)){
        const next=r.headers.get('location');await r.body?.cancel();if(!next||redirects===3)break;
        url=resultURL(new URL(next,url).href,env);continue;
      }
      const type=(r.headers.get('content-type')||'').split(';')[0].toLowerCase();
      if(!r.ok||!['image/png','image/jpeg','image/webp'].includes(type)){await r.body?.cancel();fail(502,'RESULT_DOWNLOAD_FAILED','任务已完成，但图片下载失败或格式不支持；可继续查询重试下载')}
      let bytes;try{bytes=await bytesLimited(r,20*1024*1024)}catch(e){if(e.code==='BODY_TOO_LARGE')fail(502,'RESULT_TOO_LARGE','生成图片超过 20MB，请降低生图分辨率');throw e}
      if(!bytes.length)fail(502,'RESULT_DOWNLOAD_FAILED','图片内容为空');
      return new Response(bytes,{headers:{...headers,'content-type':type}});
    }
    fail(502,'RESULT_REDIRECT','图片下载重定向次数过多');
  },30000);
}
export default {async fetch(req,env){
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff',Vary:'Origin'};
  try{
    const allowed=(env.ALLOWED_ORIGIN||ORIGIN).replace(/\/$/,'');let u;
    try{u=new URL(allowed)}catch{fail(503,'CONFIG_ORIGIN','请配置有效的 ALLOWED_ORIGIN')}
    if(u.origin!==allowed||u.protocol!=='https:')fail(503,'CONFIG_ORIGIN','ALLOWED_ORIGIN 必须是 HTTPS 来源，不能包含路径');
    const origin=req.headers.get('Origin');
    if(origin&&origin!==allowed)fail(403,'ORIGIN_DENIED','访问来源不被允许');
    if(origin===allowed)Object.assign(headers,{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'content-type,x-access-code','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Max-Age':'600'});
    const path=new URL(req.url).pathname,paths=['/api/generate-image','/api/image-status','/api/image-result','/api/generate-copy'];
    if(path!=='/health'&&!paths.includes(path))fail(404,'NOT_FOUND','接口不存在');
    if(req.method==='OPTIONS'){
      const method=req.headers.get('Access-Control-Request-Method'),hs=(req.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if(!origin||!['POST','GET'].includes(method)||hs.some(s=>!['content-type','x-access-code'].includes(s)))fail(403,'PREFLIGHT_DENIED','跨域请求不被允许');
      return new Response(null,{status:204,headers});
    }
    if(!env.ACCESS_CODE||env.ACCESS_CODE.length<24)fail(503,'CONFIG_ACCESS','请配置至少 24 位的独立 ACCESS_CODE Secret');
    if(!await equalSecret(req.headers.get('X-Access-Code')||'',env.ACCESS_CODE))fail(401,'ACCESS_DENIED','访问口令错误；请填写 ACCESS_CODE，不能填写模型 API Key');
    if(path==='/health'&&req.method==='GET')return json({ok:true,image_ready:!!env.IMAGE_API_KEY,copy_ready:!!(env.TEXT_API_KEY&&env.TEXT_MODEL),image_model:'tt-image-2.5'},200,headers);
    if(req.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请使用 POST 请求');
    if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))fail(415,'CONTENT_TYPE','请求必须为 JSON');
    let input;try{input=await timed(()=>parseJSON(req,12000),10000)}catch(e){if(e.code==='UPSTREAM_FORMAT')fail(400,'BAD_JSON','JSON 格式错误');throw e}
    if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'BAD_INPUT','请求内容必须是 JSON 对象');
    if(path==='/api/generate-copy'){
      if(!env.TEXT_API_KEY||!env.TEXT_MODEL)fail(503,'CONFIG_TEXT','请配置 TEXT_API_KEY Secret 和 TEXT_MODEL');
      const v=await provider('/chat/completions',env.TEXT_API_KEY,{model:env.TEXT_MODEL,stream:false,temperature:0.5,messages:[
        {role:'system',content:'你是农业种子营销编辑。不得编造产量、抗病性、审定编号或适种区域。只使用用户提供的事实；未提供的数据不补写。仅输出 JSON 对象，字段 headline,subline,point1,point2,point3，每项为非空的精炼中文字符串。'},
        {role:'user',content:'企业：'+clean(input.company,60)+'；品种：'+clean(input.product,70)+'；已提供卖点：'+clean(input.points,400)+'；宣传要求：'+clean(input.brief,900)}]});
      const raw=v.choices?.[0]?.message?.content;let copy;
      try{copy=JSON.parse(typeof raw==='string'?raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''):'')}
      catch{fail(502,'COPY_FORMAT','模型文案不是有效 JSON，请重试文案生成')}
      if(!copy||KEYS.some(k=>typeof copy[k]!=='string'||!copy[k].trim()))fail(502,'COPY_FORMAT','模型文案字段不完整，请重试文案生成');
      return json({copy:Object.fromEntries(KEYS.map(k=>[k,clean(copy[k],80)]))},200,headers);
    }
    if(!env.IMAGE_API_KEY)fail(503,'CONFIG_IMAGE','请配置 IMAGE_API_KEY Secret');
    if(path==='/api/generate-image'){
      const prompt=clean(input.prompt,1500),ratio=input.ratio||'3:4';
      if(!prompt)fail(400,'PROMPT_REQUIRED','请填写画面指令');
      if(!['3:4','4:5','9:16','1:1'].includes(ratio))fail(400,'BAD_RATIO','图片比例不支持');
      const v=await provider('/media/generate',env.IMAGE_API_KEY,{
        model:'tt-image-2.5',prompt:'为中国种业企业创作真实农业商业海报背景。品种：'+clean(input.product,70)+'。画面要求：'+prompt+'。画面留白，自然光照，不添加文字、商标、包装或夸大效果。',
        params:{version:'flare',aspect_ratio:ratio,resolution:'1K',quality:'auto',background:'opaque'}});
      const id=String(v.data?.task_id??v.task_id??'');
      if(!validId(id))fail(502,'TASK_ID_MISSING','模型未返回有效 task_id；请先查服务商任务记录，避免重复扣费');
      return json({task_id:id,task_token:await signTask(id,env.ACCESS_CODE),poll_after_ms:4000},202,headers);
    }
    const id=await verifyTask(input.task_token,env.ACCESS_CODE);
    const status=normalizeStatus(await provider('/media/status?task_id='+encodeURIComponent(id),env.IMAGE_API_KEY));
    if(path==='/api/image-result'){
      if(!status.result_ready)fail(409,'RESULT_NOT_READY',status.error||'任务尚未返回图片，请继续查询');
      return await downloadResult(status.result_url,env,headers);
    }
    const {result_url,...publicStatus}=status;
    return json({task_id:id,...publicStatus},200,headers);
  }catch(e){const known=e instanceof ApiError;return json({error:known?e.message:'远程服务连接失败，请稍后重试；提交超时后请先查服务商任务记录',code:known?e.code:'UPSTREAM_NETWORK'},known?e.status:502,headers)}
}};
