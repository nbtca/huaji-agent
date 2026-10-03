import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { signature } from '../src/channels/verification.ts';
import {workerBase} from './remote-config.ts';
const records = (await readFile(process.argv[2], 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const secret = process.env.HUAJIBOT_BRIDGE_HMAC_SECRET; assert.ok(secret);
let imported = 0;
for (let index=0;index<records.length;index+=50) {
  const batch=records.slice(index,index+50);
  const body=new TextEncoder().encode(JSON.stringify({records:batch}));
  assert.ok(body.length<=1024*1024);
  for(let retry=0;;retry++) {
    const timestamp=Math.floor(Date.now()/1000).toString();
    try {
      const response: Response=await fetch(workerBase()+'/channels/huajibot/archive-import',{method:'POST',body,
        signal:AbortSignal.timeout(60000),headers:{'X-HuaJiBot-Timestamp':timestamp,'X-HuaJiBot-Signature':await signature(secret,timestamp,body)}});
      assert.equal(response.status,200); const result=await response.json() as {imported:number}; assert.equal(result.imported,batch.length); break;
    } catch(error) {if(retry>=2)throw error;await new Promise(resolve=>setTimeout(resolve,2000));}
  }
  imported+=batch.length;
}
console.log('Imported history records:',imported,'(idempotent; no model/Queue/chat send).');
