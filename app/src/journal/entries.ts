import { TAGS, type Tag } from "@/journal/tags";
import type { Sql } from "@/journal/sql";

export type SyncState = "pending" | "uploaded" | "failed";

export type Entry = {
  id: string;
  date: string;
  title: string;
  body: string;
  tags: Tag[];
  syncState: SyncState;
  createdAt: string;
  updatedAt: string;
};

type EntryRow = {
  id: string;
  date: string;
  title: string;
  body: string;
  sync_state: SyncState;
  created_at: string;
  updated_at: string;
};

type TagRow = {
  entry_id: string;
  tag: string;
};

type NewEntry = {
  id?: string;
  date: string;
  title?: string;
  body: string;
  tags: readonly string[];
  syncState?: SyncState;
  now?: Date;
};

type EditedEntry = {
  date: string;
  title?: string;
  body: string;
  tags: readonly string[];
  now?: Date;
};

const SYNC_STATES: SyncState[] = ["pending", "uploaded", "failed"];

export async function prepareJournal(sql: Sql): Promise<void> {
  await sql.exec("PRAGMA foreign_keys = ON;");
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      sync_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (entry_id, tag),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pending_deletes (
      id TEXT PRIMARY KEY NOT NULL
    );
  `);
  await addTitleColumn(sql);
}

export async function createEntry(sql: Sql, input: NewEntry): Promise<Entry> {
  const entry = entryFrom(input);
  await transaction(sql, async () => {
    await insertEntry(sql, entry);
    await insertTags(sql, entry.id, entry.tags);
  });
  return entry;
}

export async function readEntry(sql: Sql, id: string): Promise<Entry | null> {
  const row = await sql.get<EntryRow>("SELECT * FROM entries WHERE id = ?", [id]);
  if (row === null) {
    return null;
  }
  const tags = await sql.all<TagRow>(
    "SELECT entry_id, tag FROM entry_tags WHERE entry_id = ?",
    [id],
  );
  return toEntry(row, tags.map((tag) => tag.tag));
}

export async function listEntries(sql: Sql): Promise<Entry[]> {
  const rows = await sql.all<EntryRow>(
    "SELECT * FROM entries ORDER BY date DESC, created_at DESC",
  );
  const tags = await sql.all<TagRow>("SELECT entry_id, tag FROM entry_tags");
  return rows.map((row) => toEntry(row, tagsFor(tags, row.id)));
}

export async function updateEntry(sql: Sql, id: string, input: EditedEntry): Promise<Entry> {
  const current = await readEntry(sql, id);
  if (current === null) {
    throw new Error("Note not found.");
  }
  const entry = replacedEntry(current, input);
  await transaction(sql, async () => {
    await updateStoredEntry(sql, entry);
    await replaceTags(sql, entry);
  });
  return entry;
}

export async function deleteEntry(sql: Sql, id: string): Promise<void> {
  const current = await readEntry(sql, id);
  if (current === null) {
    return;
  }
  await transaction(sql, async () => {
    await sql.run("DELETE FROM entries WHERE id = ?", [id]);
    await sql.run("INSERT OR IGNORE INTO pending_deletes (id) VALUES (?)", [id]);
  });
}

export async function listPendingDeletes(sql: Sql): Promise<string[]> {
  const rows = await sql.all<{ id: string }>("SELECT id FROM pending_deletes ORDER BY id");
  return rows.map((row) => row.id);
}

export function entryLabel(entry: { title: string; body: string }): string {
  const title = entry.title.trim();
  if (title !== "") {
    return title;
  }
  return firstBodyLine(entry.body);
}

async function addTitleColumn(sql: Sql): Promise<void> {
  const columns = await sql.all<{ name: string }>("PRAGMA table_info(entries)");
  if (columns.some((column) => column.name === "title")) {
    return;
  }
  await sql.exec("ALTER TABLE entries ADD COLUMN title TEXT NOT NULL DEFAULT ''");
}

function entryFrom(input: NewEntry): Entry {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: input.id ?? newId(),
    date: requireDate(input.date),
    title: cleanTitle(input.title),
    body: requireBody(input.body),
    tags: requireTags(input.tags),
    syncState: givenSyncState(input.syncState),
    createdAt: now,
    updatedAt: now,
  };
}

function newId(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireDate(date: string): string {
  if (!/^\d{8}$/.test(date)) {
    throw new Error("Date must be YYYYMMDD.");
  }
  return date;
}

function cleanTitle(title: string | undefined): string {
  return title?.trim() ?? "";
}

function requireBody(body: string): string {
  if (body.trim() === "") {
    throw new Error("A note needs a body.");
  }
  return body;
}

function requireTags(tags: readonly string[]): Tag[] {
  for (const tag of tags) {
    if (!TAGS.includes(tag as Tag)) {
      throw new Error(`Unknown tag: ${tag}`);
    }
  }
  return TAGS.filter((tag) => tags.includes(tag));
}

function givenSyncState(syncState: SyncState | undefined): SyncState {
  const state = syncState ?? "pending";
  if (!SYNC_STATES.includes(state)) {
    throw new Error(`Unknown sync state: ${state}`);
  }
  return state;
}

async function transaction(sql: Sql, work: () => Promise<void>): Promise<void> {
  await sql.exec("BEGIN");
  try {
    await work();
    await sql.exec("COMMIT");
  } catch (error) {
    await sql.exec("ROLLBACK");
    throw error;
  }
}

async function insertEntry(sql: Sql, entry: Entry): Promise<void> {
  await sql.run(
    `INSERT INTO entries (id, date, title, body, sync_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.date,
      entry.title,
      entry.body,
      entry.syncState,
      entry.createdAt,
      entry.updatedAt,
    ],
  );
}

async function insertTags(sql: Sql, id: string, tags: readonly Tag[]): Promise<void> {
  for (const tag of tags) {
    await sql.run("INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)", [id, tag]);
  }
}

function toEntry(row: EntryRow, tags: readonly string[]): Entry {
  return {
    id: row.id,
    date: row.date,
    title: row.title ?? "",
    body: row.body,
    tags: requireTags(tags),
    syncState: row.sync_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tagsFor(tags: readonly TagRow[], entryId: string): string[] {
  return tags.filter((tag) => tag.entry_id === entryId).map((tag) => tag.tag);
}

function replacedEntry(current: Entry, input: EditedEntry): Entry {
  return {
    ...current,
    date: requireDate(input.date),
    title: cleanTitle(input.title),
    body: requireBody(input.body),
    tags: requireTags(input.tags),
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
}

async function updateStoredEntry(sql: Sql, entry: Entry): Promise<void> {
  await sql.run(
    "UPDATE entries SET date = ?, title = ?, body = ?, updated_at = ? WHERE id = ?",
    [entry.date, entry.title, entry.body, entry.updatedAt, entry.id],
  );
}

async function replaceTags(sql: Sql, entry: Entry): Promise<void> {
  await sql.run("DELETE FROM entry_tags WHERE entry_id = ?", [entry.id]);
  await insertTags(sql, entry.id, entry.tags);
}

function firstBodyLine(body: string): string {
  const line = body.split(/\r?\n/).find((item) => item.trim() !== "");
  return line?.trim() ?? "";
}
