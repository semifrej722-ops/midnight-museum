import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
// Run the real inline editor handlers with controlled asynchronous image decoding.
const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
function editor() {
  const lines=html.split('\n');const ids=new Map();
  const context=vm.createContext({window:{},readImg:file=>file.decoded,render:()=>{},schedule:()=>{},toast:()=>{},$:id=>{if(!ids.has(id))ids.set(id,{});return ids.get(id)}});
  const code=['let scene=null;',...['const pendingImages=','function track(','window.seedPoster=','async function fileHandler('].map(prefix=>lines.find(line=>line.startsWith(prefix)))].join('\n');
  vm.runInContext(code,context);return context;
}
function delayedImage(name) {let resolve;return {name,decoded:new Promise(r=>{resolve=r}),finish:()=>resolve({name})};}
test('later manual background survives an earlier AI decode finishing last',async()=>{
  const context=editor(),ai=delayedImage('AI'),manual=delayedImage('manual');
  const applied=context.window.seedPoster.applyBackground(ai);
  const uploaded=context.fileHandler({files:[manual]},'scene');manual.finish();await uploaded;
  ai.finish();await applied;
  assert.equal(vm.runInContext('scene.name',context),'manual');
});
test('later AI background survives an earlier manual decode finishing last',async()=>{
  const context=editor(),manual=delayedImage('manual'),ai=delayedImage('AI');
  const uploaded=context.fileHandler({files:[manual]},'scene');
  const applied=context.window.seedPoster.applyBackground(ai);ai.finish();await applied;
  manual.finish();await uploaded;
  assert.equal(vm.runInContext('scene.name',context),'AI');
});
