import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as v from 'valibot';
import { commandJobSchema } from '../src/contracts.ts';
import type { Bindings, InitialData } from '../src/contracts.ts';
import { createCommandJob } from '../src/tools/command-job.ts';
import { createCommandPublisher } from '../src/replies/command-publisher.ts';

const destination = { bridgeInstance: 'main', robotId: 'bot', groupId: '-100:42' };
const ref: InitialData = { destination, conversationId: 'huajibot:main:bot:-100%3A42:root', rootMessageId: 'root' };
const base = {
  HUAJIBOT_ALLOWED_DESTINATIONS: JSON.stringify([destination]),
  HUAJIBOT_MAX_MESSAGE_BYTES: '32768',
} as Bindings;

test('command jobs bind sender and structured arguments and replay with a stable id', async () => {
  const one = await createCommandJob(ref, 'message-1', 'schedule', { weeks: 2 }, 'user-1', 'Alice', 'tool-1', base);
  const replay = await createCommandJob(ref, 'message-1', 'schedule', { weeks: 2 }, 'user-1', 'Alice', 'tool-1', base);
  const next = await createCommandJob(ref, 'message-2', 'mc', {}, 'user-1', 'Alice', 'tool-2', base);

  assert.equal(one.jobId, replay.jobId);
  assert.notEqual(one.jobId, next.jobId);
  assert.deepEqual(one.command, { id: 'schedule', arguments: { weeks: 2 } });
  assert.deepEqual(one.destination, { ...destination, replyToMessageId: 'message-1' });
  assert.ok(v.safeParse(commandJobSchema, one).success);
});

test('command publisher sends only valid allowlisted command jobs', async () => {
  const sent: string[] = [];
  const env = { ...base, HUAJIBOT_OUTBOUND: { send: async (body: string, options: unknown) => {
    assert.deepEqual(options, { contentType: 'text' });
    sent.push(body);
  } } as unknown as Queue<string> };
  const job = await createCommandJob(ref, 'message-1', 'events', { type: '死亡', enabled: false }, 'user-1', 'Alice', 'tool-1', env);
  await createCommandPublisher(env).publish(job);
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(sent[0]), job);
});

test('command jobs reject revoked destinations and unsupported command ids', async () => {
  await assert.rejects(
    createCommandJob(ref, 'message-1', 'schedule', { weeks: 2 }, 'user-1', 'Alice', 'tool-1', {
      ...base,
      HUAJIBOT_ALLOWED_DESTINATIONS: '[]',
    }),
    /Destination revoked/,
  );
  assert.equal(v.safeParse(commandJobSchema, {
    ...(await createCommandJob(ref, 'message-1', 'schedule', {}, 'user-1', 'Alice', 'tool-1', base)),
    command: { id: 'rm-rf', arguments: {} },
  }).success, false);
});