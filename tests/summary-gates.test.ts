import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cooldownSql,claimSql} from '../src/summary.ts';
test('summary cooldown is atomic and group leases exclude other runs until expiry',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE summary_cooldowns(scope TEXT PRIMARY KEY,requested_at INTEGER,event_id TEXT);CREATE TABLE summary_locks(scope TEXT PRIMARY KEY,run_id TEXT,expires_at INTEGER);');
 const cooldown=db.prepare(cooldownSql),claim=db.prepare(claimSql);
 assert.ok(cooldown.get('a',20000,'first',10000));assert.ok(cooldown.get('a',25000,'first',15000));assert.equal(cooldown.get('a',25000,'second',15000),undefined);assert.ok(cooldown.get('a',30000,'second',20000));
 assert.ok(claim.get('group','run1',90000,0,'run1'));assert.equal(claim.get('group','run2',90000,100,'run2'),undefined);
 assert.ok(claim.get('group','run1',91000,100,'run1'));assert.ok(claim.get('group','run2',200000,92000,'run2'));
 db.close();
});
