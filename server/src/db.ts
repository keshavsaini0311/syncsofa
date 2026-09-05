import Database from 'better-sqlite3';
import type { ChatMessage, PlaybackState, PlaylistItem } from '@syncsofa/shared';

export type Db = Database.Database;

export function openDb(path = ':memory:'): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      current_item_id INTEGER,
      is_playing INTEGER NOT NULL DEFAULT 0,
      time REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function createRoom(db: Db, id: string, now: number): void {
  db.prepare('INSERT INTO rooms (id, updated_at, created_at) VALUES (?, ?, ?)').run(id, now, now);
}

export function roomExists(db: Db, id: string): boolean {
  return !!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToItem(r: any): PlaylistItem {
  return { id: r.id, videoId: r.video_id, title: r.title, position: r.position, addedBy: r.added_by };
}

export function listItems(db: Db, roomId: string): PlaylistItem[] {
  return (db.prepare('SELECT * FROM playlist_items WHERE room_id = ? ORDER BY position').all(roomId) as any[]).map(rowToItem);
}

export function addItem(db: Db, roomId: string, videoId: string, title: string, addedBy: string, now: number): PlaylistItem {
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM playlist_items WHERE room_id = ?').get(roomId) as any).p as number;
  const info = db
    .prepare('INSERT INTO playlist_items (room_id, video_id, title, position, added_by) VALUES (?, ?, ?, ?, ?)')
    .run(roomId, videoId, title, pos, addedBy);
  const item = rowToItem(
    db.prepare('SELECT * FROM playlist_items WHERE id = ? AND room_id = ?').get(info.lastInsertRowid, roomId),
  );
  const room = db.prepare('SELECT current_item_id FROM rooms WHERE id = ?').get(roomId) as any;
  if (room && room.current_item_id == null) {
    db.prepare('UPDATE rooms SET current_item_id = ?, time = 0, is_playing = 0, updated_at = ? WHERE id = ?').run(item.id, now, roomId);
  }
  return item;
}

function reindex(db: Db, roomId: string): void {
  const upd = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND room_id = ?');
  listItems(db, roomId).forEach((it, i) => upd.run(i, it.id, roomId));
}

export function removeItem(db: Db, roomId: string, itemId: number, now: number): void {
  db.prepare('DELETE FROM playlist_items WHERE id = ? AND room_id = ?').run(itemId, roomId);
  reindex(db, roomId);
  const room = db.prepare('SELECT current_item_id FROM rooms WHERE id = ?').get(roomId) as any;
  if (room?.current_item_id === itemId) {
    const first = listItems(db, roomId)[0];
    db.prepare('UPDATE rooms SET current_item_id = ?, time = 0, is_playing = 0, updated_at = ? WHERE id = ?').run(first?.id ?? null, now, roomId);
  }
}

export function moveItem(db: Db, roomId: string, itemId: number, toPosition: number): void {
  const items = listItems(db, roomId);
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx === -1) return;
  const [moved] = items.splice(idx, 1);
  items.splice(Math.max(0, Math.min(toPosition, items.length)), 0, moved);
  const upd = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND room_id = ?');
  items.forEach((it, i) => upd.run(i, it.id, roomId));
}

export function addMessage(db: Db, roomId: string, author: string, body: string, now: number): ChatMessage {
  const info = db.prepare('INSERT INTO messages (room_id, author, body, sent_at) VALUES (?, ?, ?, ?)').run(roomId, author, body, now);
  return { id: Number(info.lastInsertRowid), author, body, sentAt: now };
}

export function listMessages(db: Db, roomId: string, limit = 100): ChatMessage[] {
  return (db.prepare('SELECT id, author, body, sent_at FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?').all(roomId, limit) as any[])
    .reverse()
    .map((r) => ({ id: r.id, author: r.author, body: r.body, sentAt: r.sent_at }));
}

export function getPlayback(db: Db, roomId: string): PlaybackState | null {
  const r = db.prepare('SELECT current_item_id, is_playing, time, updated_at FROM rooms WHERE id = ?').get(roomId) as any;
  if (!r) return null;
  return { currentItemId: r.current_item_id, isPlaying: !!r.is_playing, time: r.time, updatedAt: r.updated_at };
}

export function setPlayback(db: Db, roomId: string, isPlaying: boolean, time: number, now: number): PlaybackState | null {
  db.prepare('UPDATE rooms SET is_playing = ?, time = ?, updated_at = ? WHERE id = ?').run(isPlaying ? 1 : 0, time, now, roomId);
  return getPlayback(db, roomId);
}

export function playItem(db: Db, roomId: string, itemId: number, now: number): PlaybackState | null {
  const item = db.prepare('SELECT id FROM playlist_items WHERE id = ? AND room_id = ?').get(itemId, roomId);
  if (!item) return null;
  db.prepare('UPDATE rooms SET current_item_id = ?, is_playing = 1, time = 0, updated_at = ? WHERE id = ?').run(itemId, now, roomId);
  return getPlayback(db, roomId);
}

export function advanceAfter(db: Db, roomId: string, endedItemId: number, now: number): PlaybackState | null {
  const pb = getPlayback(db, roomId);
  if (!pb || pb.currentItemId !== endedItemId) return null; // idempotent: only the first "ended" report wins
  const items = listItems(db, roomId);
  const idx = items.findIndex((i) => i.id === endedItemId);
  const next = idx >= 0 ? items[idx + 1] : undefined;
  if (next) {
    db.prepare('UPDATE rooms SET current_item_id = ?, is_playing = 1, time = 0, updated_at = ? WHERE id = ?').run(next.id, now, roomId);
  } else {
    db.prepare('UPDATE rooms SET is_playing = 0, updated_at = ? WHERE id = ?').run(now, roomId);
  }
  return getPlayback(db, roomId);
}

export function sweepRooms(db: Db, maxAgeMs: number, now: number): number {
  return db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(now - maxAgeMs).changes;
}
