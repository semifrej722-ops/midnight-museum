
const ALLOWED='https://semifrej722-ops.github.io';
const out=(v,s=200,h={})=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...h}});
function good(a,b){if(!a||!b||a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0}
function text(s,n){return String(s||'').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,n)}
async function post(url,key,obj){const ct=new AbortController();const timer=setTimeout(()=>ct.abort(),100000);try{return await fetch(url,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(obj),signal:ct.signal})}finally{clearTimeout(timer)}}
function safeUrl(s){try{let u=new URL(s),h=u.hostname.toLowerCase();return u.protocol==='https:'&&h!=='localhost'&&!h.endsWith('.local')&&!/^[0-9.]+$/.test(h)&&!h.startsWith('[')}catch{return false}}
export default{async fetch(req,env){
const origin=req.headers.get('Origin')||'',allow=(env.ALLOWED_ORIGIN||ALLOWED).replace(/\/$/,'');
const headers={'Access-Control-Allow-Origin':allow,'Access-Control-Allow-Headers':'content-type,x-access-code','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Vary':'Origin'};
if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
const path=new URL(req.url).pathname;
if(path==='/health')return out({ok:true,image_ready:!!(env.AI_API_KEY&&env.IMAGE_MODEL),copy_ready:!!(env.AI_API_KEY&&env.TEXT_MODEL)},200,headers);
if(req.method!=='POST'||!['/api/generate-image','/api/generate-copy'].includes(path))return out({error:'Not found'},404,headers);
if(origin!==allow)return out({error:'访问来源不被允许'},403,headers);
if(!good(req.headers.get('X-Access-Code')||'',env.ACCESS_CODE||''))return out({error:'访问口令错误'},401,headers);
if(!env.AI_API_KEY)return out({error:'尚未配置模型密钥'},503,headers);
if(Number(req.headers.get('content-length')||0)>12000)return out({error:'提交内容过大'},413,headers);
let input;try{input=await req.json();if(!input||typeof input!=='object')throw 0}catch{return out({error:'JSON 格式错误'},400,headers)}
let base=(env.API_BASE_URL||'https://api.lk888.ai/v1').replace(/\/$/,'');
if(!/^https:\/\//.test(base)||!base.endsWith('/v1'))return out({error:'服务端 API 地址设置错误'},500,headers);
try{
if(path==='/api/generate-image'){
if(!env.IMAGE_MODEL)return out({error:'需要先在 Worker 配置 IMAGE_MODEL'},503,headers);
let prompt='为中国种业企业创作真实农业商业海报的背景素材。品种：'+text(input.product,70)+'。要求：'+text(input.prompt,900)+'。构图适合高质量宣传海报，画面有留白，真实玉米田和玉米穗，自然光照。不要添加任何文字、商标、产品包装、夸大效果。';
let r=await post(base+'/images/generations',env.AI_API_KEY,{model:env.IMAGE_MODEL,prompt,n:1,size:'1024x1024'});
if(!r.ok)return out({error:'生图接口报错 '+r.status+'。检查模型、余额或参数。'},502,headers);
let x=await r.json(),item=x?.data?.[0]||x?.images?.[0]||{};
let b=item.b64_json||item.base64;if(b)return out({image:'data:image/png;base64,'+b},200,headers);
let link=item.url||item.image_url;if(!link||!safeUrl(link))return out({error:'模型返回格式暂不兼容'},502,headers);
let f=await fetch(link,{redirect:'follow'});if(!f.ok||!(f.headers.get('content-type')||'').startsWith('image/'))return out({error:'无法取得生成图片'},502,headers);
return new Response(f.body,{status:200,headers:{...headers,'cache-control':'no-store','content-type':f.headers.get('content-type')||'image/png'}});
}
if(!env.TEXT_MODEL)return out({error:'需要先在 Worker 配置 TEXT_MODEL'},503,headers);
let system='你是农业种子营销编辑，不得编造产量、抗病性、审定编号或适种区域。仅输出JSON对象，字段 headline,subline,point1,point2,point3，内容精炼。';
let user='企业：'+text(input.company,40)+'；品种：'+text(input.product,40)+'；已提供卖点：'+text(input.points,260)+'；宣传要求：'+text(input.brief,500);
let r=await post(base+'/chat/completions',env.AI_API_KEY,{model:env.TEXT_MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:.5});
if(!r.ok)return out({error:'文案接口报错 '+r.status+'。检查模型或余额。'},502,headers);
let x=await r.json(),raw=x?.choices?.[0]?.message?.content;if(typeof raw!=='string')return out({error:'模型没有返回文本'},502,headers);
let v;try{v=JSON.parse(raw.replace(/^\\s*\`\`\`(?:json)?/,'').replace(/\`\`\`\\s*$/,''))}catch{return out({error:'文案格式非JSON，请重试'},502,headers)}
let copy={};for(const k of ['headline','subline','point1','point2','point3'])copy[k]=text(v[k],80);return out({copy},200,headers);
}catch(e){return out({error:e?.name==='AbortError'?'模型响应超时':'远程模型接口调用失败'},502,headers)}
}};