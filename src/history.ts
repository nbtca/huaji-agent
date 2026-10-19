import type { Bindings, IngressEvent } from './contracts.ts';
export const chinaDay = (timestamp: number) => new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
// Row values let SQLite seek past the cursor. Behind bound parameters the OR form scans the day from its start.
export const historyPage = 'SELECT message_id,sender_name,text,observed_at FROM group_messages WHERE bridge=? AND robot=? AND chat=? AND day=? AND observed_at<=? AND (observed_at,message_id)>(?,?) ORDER BY observed_at,message_id LIMIT 20';
export async function archive(env: Bindings, event: IngressEvent) {
  if (!env.HISTORY) return;
  const time = event.message.observedAt ?? Date.now();
  if (time > Date.now() + 300000 || time < Date.now() - 4 * 86400000) return;
  await env.HISTORY.prepare('INSERT OR IGNORE INTO group_messages VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(event.destination.bridgeInstance, event.destination.robotId, event.destination.groupId, event.message.messageId,
      event.message.senderId, event.message.senderName, event.message.text, time, chinaDay(time)).run();
}
