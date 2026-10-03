CREATE TABLE IF NOT EXISTS group_messages (
 bridge TEXT NOT NULL, robot TEXT NOT NULL, chat TEXT NOT NULL, message_id TEXT NOT NULL,
 sender TEXT NOT NULL, sender_name TEXT NOT NULL, text TEXT NOT NULL, observed_at INTEGER NOT NULL,
 day TEXT NOT NULL, PRIMARY KEY(bridge,robot,chat,message_id));
CREATE INDEX IF NOT EXISTS history_day ON group_messages(bridge,robot,chat,day,observed_at);
CREATE TABLE IF NOT EXISTS summary_runs (
 run_id TEXT PRIMARY KEY, chat TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL,
 updated_at INTEGER NOT NULL);
