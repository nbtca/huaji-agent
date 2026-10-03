// Isolated acceptance destination only. The real bot consumer must be stopped.
import assert from 'node:assert/strict';
import { component, conversationPrefix } from '../src/contracts.ts';
import { signature } from '../src/channels/verification.ts';
import {destination as testDestination,workerBase,queueBase} from './remote-config.ts';
const secret=process.env.HUAJIBOT_BRIDGE_HMAC_SECRET!,token=process.env.HUAJIBOT_QUEUE_API_TOKEN!;
assert.ok(secret&&token);
const destination=testDestination(process.env.HUAJIBOT_TEST_ACCEPTANCE_GROUP_ID??'__worker_acceptance__');
const prefix='features-'+crypto.randomUUID(); console.log('Acceptance run',prefix);
const queue=queueBase();
const held: string[]=[];
async function signed(action:string,payload:unknown) {
 const body=new TextEncoder().encode(JSON.stringify(payload));
 for(let retry=0;;retry++){try{const ts=Math.floor(Date.now()/1000).toString();const r=await fetch(workerBase()+'/channels/huajibot/'+action,{method:'POST',body,signal:AbortSignal.timeout(90000),headers:{'X-HuaJiBot-Timestamp':ts,'X-HuaJiBot-Signature':await signature(secret,ts,body)}});assert.ok(r.ok,'Ingress '+r.status);return await r.json();}catch(e){if(retry>=2)throw e;await new Promise(r=>setTimeout(r,2000));}}
}
function event(id:string,text:string,kind='chat',images:string[]=[],root=id,replyTo:unknown=null) {return {version:1,eventId:[destination.bridgeInstance,destination.robotId,destination.groupId,id].map(component).join(':'),conversationId:conversationPrefix(destination)+component(root),destination,kind,message:{messageId:id,senderId:'acceptance',senderName:'Acceptance fixture',text,images,observedAt:Date.now()},replyTo};}
async function queueCall(action:string,payload:unknown) {for(let retry=0;;retry++){try{const r=await fetch(queue+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return (await r.json() as any).result;}catch(e){if(retry>=2)throw e;await new Promise(r=>setTimeout(r,1000));}}}
async function receive(id:string) {
 const deadline=Date.now()+240000;
 while(Date.now()<deadline){const result=await queueCall('pull',{batch_size:5,visibility_timeout:900000});for(const lease of result.messages??[]){let job;try{job=JSON.parse(lease.body);}catch{held.push(lease.lease_id);continue;}
 if(job.destination.groupId!==destination.groupId||!job.destination.replyToMessageId.startsWith(prefix)){held.push(lease.lease_id);continue;}
 await queueCall('ack',{acks:[{lease_id:lease.lease_id}],retries:[]}); assert.equal(job.destination.replyToMessageId,id);assert.ok(job.content.text.trim());return job;
 }await new Promise(r=>setTimeout(r,1000));}throw new Error('Reply timeout: '+id);
}
try {
if(process.argv.includes('--weather-alias-only')) {
 const weather=prefix+'-weather';await signed('events',event(weather,'搜索今日宁波天气，给出气温、今日范围、更新时间和来源。'));
 const answer=await receive(weather);console.log('Weather answer:',answer.content.text.slice(0,2000));
 assert.ok(/\d+(?:\.\d+)?\s*(?:℃|°C|度)/.test(answer.content.text));assert.ok(/open-meteo/i.test(answer.content.text));
 const records=Array.from({length:12},(_,i)=>event(prefix+'-archive-'+i,'隔离验收记录：小组约定周五整理项目文档。第'+i+'条。','archive'));
 await signed('archive-import',{records});
 const summary=prefix+'-summary';await signed('events',event(summary,'总结 今 日','chat'));
 const job=await receive(summary);assert.equal(job.kind,'summary');console.log('Spaced 今日 alias entered the summary Workflow.');
} else {
if(!process.argv.includes('--skip-search')) {
const search=prefix+'-search'; await signed('events',event(search,'请实际调用WebSearch的web_search搜索Cloudflare Workers文档，并给出一个检索到的来源网址。'));
const searched=await receive(search);console.log('Search answer:',searched.content.text.slice(0,1600));assert.ok(/https?:\/\//.test(searched.content.text));console.log('Agent MCP search and Queue reply passed.');
}
const vision=prefix+'-vision';await signed('events',event(vision,'图片中的编程语言缩写是什么？只回答缩写，不要描述颜色。','chat',['https://raw.githubusercontent.com/github/explore/main/topics/csharp/csharp.png']));
const pictured=await receive(vision);assert.ok(/C#|C Sharp|CSharp|C♯/i.test(pictured.content.text));assert.ok(!/紫|purple/i.test(pictured.content.text));console.log('Real image recognition passed without revealing the follow-up answer.');
const follow=prefix+'-follow';await signed('events',event(follow,'之前那张图的主色是什么？不要搜索，依据图片回答。','chat',[],vision,{messageId:vision,senderId:'acceptance',content:pictured.content.text}));
const followed=await receive(follow);assert.ok(/紫|purple/i.test(followed.content.text));console.log('Image follow-up retained image context.');
const records=Array.from({length:12},(_,i)=>event(prefix+'-archive-'+i,'真实验收用隔离记录：小组决定周五完成文档，并由小李整理会议记录。第'+i+'条。','archive'));
await signed('archive-import',{records});
const summary=prefix+'-summary';await signed('events',event(summary,'总结 今天','summary'));
const summarized=await receive(summary);assert.equal(summarized.kind,'summary');assert.ok(/今日要点|待办/.test(summarized.content.text));console.log('D1 archive + durable summary Workflow + Queue reply passed. No production group message sent.');
}
} finally { if(held.length) await queueCall('ack',{acks:[],retries:held.map(lease_id=>({lease_id,delay_seconds:0}))}); }
