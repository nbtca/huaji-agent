import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyPage } from '../src/history.ts';

const migrations = ['0001_history', '0004_history_expiry'];

function database() {
  const db = new DatabaseSync(':memory:');
  for (const name of migrations) db.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  return db;
}

test('history pages follow the cursor through messages that share a timestamp', () => {
  const db = database();
  const insert = db.prepare('INSERT INTO group_messages VALUES (?,?,?,?,?,?,?,?,?)');
  const ids: string[] = [];
  for (let i = 0; i < 95; i++) {
    const id = `m${String(i * 7 % 95).padStart(3, '0')}`;
    insert.run('main', 'bot', 'chat', id, 's', 'n', 't', 1000 + Math.floor(i / 6), '2026-10-18');
    ids.push(id);
  }
  insert.run('main', 'bot', 'other', 'x', 's', 'n', 't', 1000, '2026-10-18');
  insert.run('main', 'bot', 'chat', 'y', 's', 'n', 't', 1000, '2026-10-17');
  insert.run('main', 'bot', 'chat', 'late', 's', 'n', 't', 9999, '2026-10-18');

  const expected = db.prepare("SELECT message_id FROM group_messages WHERE chat='chat' AND day='2026-10-18' AND observed_at<=5000 ORDER BY observed_at,message_id").all().map((row) => row.message_id);
  const page = db.prepare(historyPage);
  const seen: unknown[] = [];
  let time = -1, id = '';
  for (;;) {
    const rows = page.all('main', 'bot', 'chat', '2026-10-18', 5000, time, id) as { message_id: string; observed_at: number }[];
    if (!rows.length) break;
    seen.push(...rows.map((row) => row.message_id));
    ({ observed_at: time, message_id: id } = rows.at(-1)!);
  }
  assert.equal(expected.length, 95);
  assert.deepEqual(seen, expected);
  db.close();
});

test('history queries seek instead of scanning the table', () => {
  const db = database();
  const plan = (sql: string) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => String(row.detail)).join(' | ');
  assert.match(plan(historyPage), /SEARCH group_messages USING INDEX history_day \(bridge=\? AND robot=\? AND chat=\? AND day=\? AND observed_at>\? AND observed_at<\?\)/);
  assert.match(plan('DELETE FROM group_messages WHERE observed_at<?'), /SEARCH group_messages USING (COVERING )?INDEX history_expiry/);
  db.close();
});
