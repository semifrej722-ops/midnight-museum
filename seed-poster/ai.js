import {createClient, pollImageTask} from './ai-client.js';
const $=id=>document.getElementById(id);
const ep=$('aiEndpoint'),access=$('aiAccess'),status=$('aiStatus');
const imageButton=$('aiImageBtn'),copyButton=$('aiCopyBtn'),resume=$('aiResumeBtn'),cancel=$('aiCancelBtn'),forget=$('aiForgetBtn'),check=$('aiCheckBtn');
const TASK_KEY='seedposter_pending_task_v2';
let task=null,busy=false,controller=null;
try{ep.value=localStorage.getItem('seedposter_endpoint')||''}catch{}
try{const saved=JSON.parse(sessionStorage.getItem(TASK_KEY)||'null');if(saved&&typeof saved.task_token==='string'&&typeof saved.endpoint==='string'&&typeof saved.task_id==='string')task=saved}catch{}
ep.addEventListener('change',()=>{try{localStorage.setItem('seedposter_endpoint',ep.value.trim())}catch{}});
function saveTask(value){task=value;try{if(value)sessionStorage.setItem(TASK_KEY,JSON.stringify(value));else sessionStorage.removeItem(TASK_KEY)}catch{}update()}
function update(){
  imageButton.disabled=busy||!!task;copyButton.disabled=busy;check.disabled=busy;resume.disabled=busy||!task;
  resume.hidden=!task;forget.hidden=!task;forget.disabled=busy;cancel.hidden=!busy||!controller;
  ep.disabled=busy;access.disabled=busy;$('reset').disabled=busy;
}
const configure=()=>createClient({url:ep.value.trim().replace(/\/$/,''),secret:access.value});
function taskClient(){const client=configure();if(client.url!==task.endpoint)throw Error('请填写此任务原来的 Worker 地址后继续查询');return client}
function started(message,canCancel=false){busy=true;controller=canCancel?new AbortController():null;status.textContent=message;update()}
function stopped(){busy=false;controller=null;update()}
async function completeTask(client){
  const active=task;
  await pollImageTask(client,active,{signal:controller.signal,onProgress:value=>{
    status.textContent=value.state==='retrying'?'查询暂时失败，正在重试（'+value.retry+'/3）…':'任务 '+active.task_id+'：'+(value.state==='success'?'生成完成，正在下载…':'生成中 '+(value.progress||0)+'%');
  }});
  const blob=await client.request('/api/image-result',{task_token:active.task_token},{signal:controller.signal});
  if(!(blob instanceof Blob))throw Error('没有收到可用图片');
  const applied=await window.seedPoster.applyBackground(blob);
  saveTask(null);status.textContent=applied?'AI 背景已生成并加入海报，可下载 PNG。':'AI 背景已返回；保留了你随后选择的图片。';
}
function showError(prefix,error){
  if(error.code==='TASK_FAILED'){saveTask(null);status.textContent='生图失败：'+error.message;return}
  if(error.name==='AbortError'){status.textContent='已停止本地等待。服务商仍可能继续生成和计费，点击“继续查询”可恢复。';return}
  status.textContent=prefix+error.message+(task?'。任务 '+task.task_id+' 已保留，可继续查询，不会重新生成。':'');
}
imageButton.addEventListener('click',async()=>{
  if(busy||task)return;
  try{
    const client=configure();started('正在提交生图任务，请勿重复点击；断线后请先查看服务商任务记录…');
    const value=await client.request('/api/generate-image',{product:$('product').value,prompt:$('aiPrompt').value,ratio:document.querySelector('.ratio.active').dataset.ratio});
    if(!value.task_token||!value.task_id)throw Error('没有收到任务凭证，请先查服务商任务记录');
    saveTask({task_id:String(value.task_id),task_token:value.task_token,endpoint:client.url});
    controller=new AbortController();update();await completeTask(client);
  }catch(error){showError('生图失败：',error)}finally{stopped()}
});
resume.addEventListener('click',async()=>{
  if(busy||!task)return;
  try{const client=taskClient();started('继续查询原任务，不会重新提交…',true);await completeTask(client)}
  catch(error){showError('查询失败：',error)}finally{stopped()}
});
cancel.addEventListener('click',()=>controller?.abort());
forget.addEventListener('click',()=>{
  if(busy)return;
  saveTask(null);status.textContent='已清除本地任务记录；这不会取消服务商任务或退款。新生成可能再次计费。';
});
copyButton.addEventListener('click',async()=>{
  if(busy)return;
  try{
    const client=configure();started('正在生成宣传文案…');
    const value=await client.request('/api/generate-copy',{product:$('product').value,company:$('company').value,brief:$('aiPrompt').value,points:[$('point1').value,$('point2').value,$('point3').value].join('；')});
    const keys=['headline','subline','point1','point2','point3'];
    if(!value.copy||keys.some(k=>typeof value.copy[k]!=='string'||!value.copy[k].trim()))throw Error('文案字段不完整，原有文案已保留');
    for(const k of keys){$(k).value=value.copy[k];$(k).dispatchEvent(new Event('input',{bubbles:true}))}
    status.textContent='文案已更新，品种性状请对照官方资料核实。';
  }catch(error){showError('文案失败：',error)}finally{stopped()}
});
check.addEventListener('click',async()=>{
  if(busy)return;
  try{const client=configure();started('正在检查后端配置…');const value=await client.request('/health');status.textContent='后端已连接；生图配置：'+(value.image_ready?'齐全':'缺少 IMAGE_API_KEY')+'；文案配置：'+(value.copy_ready?'齐全':'缺少 TEXT_API_KEY 或 TEXT_MODEL')+'。这仅检查配置，不代表真实生成已验证。'}
  catch(error){showError('连接检查失败：',error)}finally{stopped()}
});
if(task)status.textContent='有尚未取回的任务 '+task.task_id+'。输入访问口令后点击“继续查询”，不会重新提交。';
update();
