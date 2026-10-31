import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient, pollImageTask, ClientError} from '../ai-client.js';
import {posterPNG} from '../poster-export.js';
test('polls sequentially through running to success without creating another task',async()=>{
  const responses=[{state:'running',progress:30,is_final:false},{state:'success',is_final:true,result_ready:true}];let calls=0,waits=0;
  const client={request:async(path,body)=>{assert.equal(path,'/api/image-status');assert.deepEqual(body,{task_token:'signed'});calls++;return responses.shift()}};
  const result=await pollImageTask(client,{task_token:'signed'},{sleep:async()=>{waits++}});
  assert.equal(result.state,'success');assert.equal(calls,2);assert.equal(waits,1);
});
test('terminal failure is never polled again and no image is applied',async()=>{
  let calls=0;const client={request:async()=>{calls++;return {state:'failed',is_final:true,error:'任务失败'}}};
  await assert.rejects(pollImageTask(client,{task_token:'signed'}),e=>e.code==='TASK_FAILED');assert.equal(calls,1);
});
test('temporary status errors retry with a limit, auth errors stop immediately',async()=>{
  let calls=0;const client={request:async()=>{calls++;throw new ClientError('unavailable',503,'UPSTREAM_HTTP')}};
  await assert.rejects(pollImageTask(client,{task_token:'signed'},{sleep:async()=>{}}));assert.equal(calls,4);
  calls=0;client.request=async()=>{calls++;throw new ClientError('denied',401,'ACCESS_DENIED')};
  await assert.rejects(pollImageTask(client,{task_token:'signed'},{sleep:async()=>{}}));assert.equal(calls,1);
});
test('poll timeout and cancellation preserve resumable task without resubmission',async()=>{
  let time=0;const controller=new AbortController();let calls=0;
  const client={request:async()=>{calls++;return {state:'running',is_final:false}}};
  await assert.rejects(pollImageTask(client,{task_token:'signed'},{now:()=>time,maxMs:10,sleep:async()=>{time=11}}),e=>e.code==='POLL_TIMEOUT');assert.equal(calls,1);
  controller.abort();await assert.rejects(pollImageTask(client,{task_token:'signed'},{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(calls,1);
});
test('client rejects endpoint paths, credentials and insecure URLs before sending access code',()=>{
  for(const url of ['http://evil.example','https://user:password@evil.example','https://evil.example/path','https://evil.example/?key=x'])assert.throws(()=>createClient({url,secret:'a'.repeat(24)}));
});
test('client sends no credentials on redirects and does not retry billed creation',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers['X-Access-Code'],'a'.repeat(24));throw new TypeError('network')});
  const client=createClient({url:'https://worker.example',secret:'a'.repeat(24)});
  await assert.rejects(client.request('/api/generate-image',{prompt:'field'}),e=>e.code==='NETWORK');assert.equal(calls,1);
});
test('client explains non-JSON errors and accepts a Worker image blob',async t=>{
  const client=createClient({url:'https://worker.example',secret:'a'.repeat(24)});
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>error</html>',{status:502,headers:{'Content-Type':'text/html'}}));
  await assert.rejects(client.request('/api/image-status',{}),e=>e.code==='RESPONSE_FORMAT');t.mock.restoreAll();
  t.mock.method(globalThis,'fetch',async()=>new Response('image',{headers:{'Content-Type':'image/png'}}));
  const blob=await client.request('/api/image-result',{});assert.ok(blob instanceof Blob);assert.equal(blob.type,'image/png');
});
test('PNG export waits for pending images and fonts, then renders and exports PNG',async()=>{
  const order=[];const canvas={toBlob:cb=>{order.push('png');cb(new Blob(['png'],{type:'image/png'}))}};
  const blob=await posterPNG({canvas,ready:async()=>{order.push('images')},fonts:Promise.resolve().then(()=>order.push('fonts')),render:()=>order.push('render')});
  assert.equal(blob.type,'image/png');assert.ok(order.indexOf('render')>order.indexOf('images'));assert.ok(order.indexOf('render')>order.indexOf('fonts'));assert.equal(order.at(-1),'png');
});
test('PNG export reports null encoder output and canvas security errors',async()=>{
  await assert.rejects(posterPNG({canvas:{toBlob:cb=>cb(null)},render:()=>{}}),/PNG/);
  await assert.rejects(posterPNG({canvas:{toBlob:()=>{throw new DOMException('tainted','SecurityError')}},render:()=>{}}),/跨域/);
});
