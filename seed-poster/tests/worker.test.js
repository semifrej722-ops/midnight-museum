import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const origin = 'https://semifrej722-ops.github.io';
const env = {IMAGE_API_KEY:'test-image-only',TEXT_API_KEY:'test-text-only',ACCESS_CODE:'test-access-code-at-least-24-characters',TEXT_MODEL:'test-chat',IMAGE_RESULT_HOSTS:'cdn.example.com'};
function request(path, body={}, options={}) {
  return new Request('https://worker.example'+path, {method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Access-Code':env.ACCESS_CODE,...options.headers},body:typeof body==='string'?body:JSON.stringify(body)});
}
async function run(req, config=env) {return worker.fetch(req,config);}
function upstream(t, handler) {t.mock.method(globalThis,'fetch',handler);}
const json = (v, status=200) => new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
async function created(t) {
  upstream(t,async()=>json({code:200,data:{task_id:'123456'},msg:'created'}));
  const r=await run(request('/api/generate-image',{prompt:'真实玉米田',ratio:'3:4'}));
  assert.equal(r.status,202);return r.json();
}
test('submits documented async payload using only image secret',async t=>{
  let seen;
  upstream(t,async(url,init)=>{seen={url,init};return json({code:200,data:{task_id:123456}})});
  const r=await run(request('/api/generate-image',{product:'示例',prompt:'玉米田',ratio:'3:4'}));
  assert.equal(r.status,202);
  const v=await r.json();assert.equal(v.task_id,'123456');assert.ok(v.task_token);
  assert.equal(seen.url,'https://api.lk888.ai/v1/media/generate');
  assert.equal(seen.init.headers.authorization,'Bearer test-image-only');
  const body=JSON.parse(seen.init.body);assert.equal(body.model,'tt-image-2.5');
  assert.equal(body.params.aspect_ratio,'3:4');assert.equal(body.params.resolution,'1K');assert.ok(body.prompt.includes('玉米田'));
});
test('rejects unauthenticated, cross-origin and missing access configuration without upstream calls',async t=>{
  let calls=0;upstream(t,async()=>{calls++;throw Error('must not call')});
  for(const [req,config,status] of [
    [request('/api/generate-copy',{}, {headers:{'X-Access-Code':'wrong'}}),env,401],
    [request('/api/generate-copy',{}, {headers:{Origin:'https://evil.example'}}),env,403],
    [request('/api/generate-copy'),{...env,ACCESS_CODE:''},503]]) {
    const r=await run(req,config);assert.equal(r.status,status);
    if(status===403)assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
  }
  assert.equal(calls,0);
});
test('preflight allows only the exact configured origin and supported methods/headers',async()=>{
  const r=await run(new Request('https://worker.example/api/generate-image',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-access-code'}}));
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
  const bad=await run(new Request('https://worker.example/api/generate-image',{method:'OPTIONS',headers:{Origin:'https://evil.example'}}));assert.equal(bad.status,403);assert.equal(bad.headers.get('Access-Control-Allow-Origin'),null);
});
test('body limit applies even without content-length and malformed input is rejected',async t=>{
  upstream(t,async()=>{throw Error('must not call')});
  assert.equal((await run(request('/api/generate-image',{prompt:'字'.repeat(12000)}))).status,413);
  assert.equal((await run(request('/api/generate-image','{'))).status,400);
  assert.equal((await run(request('/api/generate-image',[]))).status,400);
});
test('image and text readiness and secrets are independent',async t=>{
  upstream(t,async(url,init)=>{
    assert.equal(url,'https://api.lk888.ai/v1/chat/completions');assert.equal(init.headers.authorization,'Bearer test-text-only');
    return json({choices:[{message:{content:'```json\n{"headline":"好种子","subline":"真实资料","point1":"可核查","point2":"按区选种","point3":"咨询企业"}\n```'}}]});
  });
  const r=await run(request('/api/generate-copy',{brief:'精炼'}),{...env,IMAGE_API_KEY:''});assert.equal(r.status,200);assert.equal((await r.json()).copy.headline,'好种子');
  assert.equal((await run(request('/api/generate-copy'),{...env,TEXT_API_KEY:''})).status,503);
});
test('HTTP 200 provider errors and HTML responses never become successful tasks or leak secrets',async t=>{
  for(const response of [json({code:500,msg:env.IMAGE_API_KEY}),new Response('<html>bad gateway</html>',{status:502})]) {
    upstream(t,async()=>response);const r=await run(request('/api/generate-image',{prompt:'田间'}));assert.equal(r.status,502);assert.ok(!(await r.text()).includes(env.IMAGE_API_KEY));t.mock.restoreAll();
  }
});
test('status verifies signed task before querying upstream and normalizes terminal state',async t=>{
  const task=await created(t);t.mock.restoreAll();let calls=0;
  upstream(t,async(url,init)=>{calls++;assert.equal(url,'https://api.lk888.ai/v1/media/status?task_id=123456');assert.equal(init.headers.authorization,'Bearer test-image-only');return json({code:200,data:{task_id:123456,state:'success',is_final:true,progress:'100%',result_url:'https://cdn.example.com/a.png',result_type:'image',error:'',cost:0.2}})});
  const r=await run(request('/api/image-status',{task_token:task.task_token}));const v=await r.json();assert.equal(r.status,200);assert.equal(v.state,'success');assert.equal(v.is_final,true);assert.equal(v.result_ready,true);assert.equal(v.result_url,undefined);
  assert.equal((await run(request('/api/image-status',{task_token:task.task_token+'x'}))).status,401);assert.equal(calls,1);
});
test('failed and unknown terminal tasks terminate and redact upstream error details',async t=>{
  const task=await created(t);t.mock.restoreAll();
  for(const state of ['failed','refunding','CANCELED','UNKNOWN','new_terminal']) {
    upstream(t,async()=>json({task_id:123456,state,is_final:true,error:env.IMAGE_API_KEY}));
    const r=await run(request('/api/image-status',{task_token:task.task_token}));const v=await r.json();assert.equal(v.state,'failed');assert.equal(v.is_final,true);assert.ok(!JSON.stringify(v).includes(env.IMAGE_API_KEY));t.mock.restoreAll();
  }
});
test('download only proxies verified task result, does not forward credentials to CDN',async t=>{
  const task=await created(t);t.mock.restoreAll();
  upstream(t,async(url,init)=>{
    if(url.includes('/media/status'))return json({state:'success',is_final:true,result_url:'https://cdn.example.com/a.png'});
    assert.equal(url,'https://cdn.example.com/a.png');assert.equal(new Headers(init.headers).get('authorization'),null);
    return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'Content-Type':'image/png'}});
  });
  const r=await run(request('/api/image-result',{task_token:task.task_token}));assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/png');assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
});
test('result proxy blocks private hosts, unapproved hosts and redirect escapes',async t=>{
  const task=await created(t);t.mock.restoreAll();
  for(const link of ['https://127.0.0.1/a','https://evil.example/a','https://cdn.example.com/a']) {
    let count=0;upstream(t,async(url)=>{count++;if(url.includes('/media/status'))return json({state:'success',is_final:true,result_url:link});return new Response(null,{status:302,headers:{Location:'https://169.254.169.254/secret'}})});
    const r=await run(request('/api/image-result',{task_token:task.task_token}));assert.equal(r.status,502);assert.ok(count<=2);t.mock.restoreAll();
  }
});
test('rejects missing copy fields instead of silently applying incomplete or object copy',async t=>{
  upstream(t,async()=>json({choices:[{message:{content:'{"headline":{}}'}}]}));
  const r=await run(request('/api/generate-copy'));assert.equal(r.status,502);
});
