import {
  createEntry,
  deleteEntry,
  entriesForFilter,
  entryLabel,
  listEntries,
  listPendingDeletes,
  prepareJournal,
  readEntry,
  updateEntry,
  type Entry,
} from "@/journal/entries";
import { nodeSql } from "@/journal/node-sql";
import type { Sql } from "@/journal/sql";
import { readSession, signIn, signOut, visibleScreen, type SessionStore } from "@/session/session";

function memorySession(): SessionStore {
  let value: string | null = null;
  return {
    async get() {
      return value;
    },
    async set(_key, next) {
      value = next;
    },
    async remove() {
      value = null;
    },
  };
}

async function journal(): Promise<Sql> {
  const sql = nodeSql();
  await prepareJournal(sql);
  return sql;
}

describe("journal entries", () => {
  it("creates, reads, and lists a note with more than one tag", async () => {
    const sql = await journal();
    const created = await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      body: "Walked home along the river.",
      tags: ["life", "thoughts"],
      now: new Date("2026-10-28T08:00:00.000Z"),
    });

    expect(created).toEqual({
      id: "note-1",
      date: "20261028",
      title: "",
      body: "Walked home along the river.",
      tags: ["life", "thoughts"],
      syncState: "pending",
      createdAt: "2026-10-28T08:00:00.000Z",
      updatedAt: "2026-10-28T08:00:00.000Z",
    });
    expect(await readEntry(sql, "note-1")).toEqual(created);

    await createEntry(sql, {
      id: "note-2",
      date: "20261029",
      body: "Newer note.",
      tags: ["work"],
      now: new Date("2026-10-29T08:00:00.000Z"),
    });
    const listed = await listEntries(sql);
    expect(listed.map((entry) => entry.id)).toEqual(["note-2", "note-1"]);
  });

  it("updates the note and keeps its sync state", async () => {
    const sql = await journal();
    await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      body: "First draft.",
      tags: ["life", "work"],
      syncState: "uploaded",
      now: new Date("2026-10-28T08:00:00.000Z"),
    });

    const updated = await updateEntry(sql, "note-1", {
      date: "20261027",
      title: "  River walk  ",
      body: "Revised.",
      tags: ["thoughts"],
      now: new Date("2026-10-29T09:00:00.000Z"),
    });

    expect(updated).toMatchObject({
      id: "note-1",
      date: "20261027",
      title: "River walk",
      body: "Revised.",
      tags: ["thoughts"],
      syncState: "uploaded",
      createdAt: "2026-10-28T08:00:00.000Z",
      updatedAt: "2026-10-29T09:00:00.000Z",
    });
    expect(await readEntry(sql, "note-1")).toEqual(updated);
  });

  it("removes a deleted note from the list and keeps its id for the cloud delete", async () => {
    const sql = await journal();
    await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      body: "Gone from the list.",
      tags: ["life", "learnings"],
    });

    await deleteEntry(sql, "note-1");

    expect(await readEntry(sql, "note-1")).toBeNull();
    expect(await listEntries(sql)).toEqual([]);
    expect(await listPendingDeletes(sql)).toEqual(["note-1"]);
    expect(
      await sql.all("SELECT entry_id FROM entry_tags WHERE entry_id = ?", ["note-1"]),
    ).toEqual([]);

    await deleteEntry(sql, "note-1");
    expect(await listPendingDeletes(sql)).toEqual(["note-1"]);
  });

  it("assigns an id when the screen does not", async () => {
    const sql = await journal();
    const created = await createEntry(sql, {
      date: "20261028",
      body: "A note.",
      tags: ["life"],
    });
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("rejects a blank body, a bad date, and an unknown tag", async () => {
    const sql = await journal();
    await expect(
      createEntry(sql, { date: "20261028", body: "   ", tags: ["life"] }),
    ).rejects.toThrow("A note needs a body.");
    await expect(
      createEntry(sql, { date: "2026-10-28", body: "A note.", tags: ["life"] }),
    ).rejects.toThrow("Date must be YYYYMMDD.");
    await expect(
      createEntry(sql, { date: "20261028", body: "A note.", tags: ["life", "nope"] }),
    ).rejects.toThrow("Unknown tag: nope");
    expect(await listEntries(sql)).toEqual([]);
  });

  it("leaves the notes in place when the session is signed out", async () => {
    const sql = await journal();
    await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      body: "Still on the phone.",
      tags: ["work"],
    });
    const session = memorySession();
    await signIn(session, "ada@example.com", "secret-password");
    await signOut(session);

    expect(await readSession(session)).toBeNull();
    expect(visibleScreen({ ready: true, session: null })).toBe("sign-in");
    expect(await listEntries(sql)).toEqual([
      expect.objectContaining({ id: "note-1", body: "Still on the phone." }),
    ]);
  });

  it("keeps a blank title blank and uses it as the label when present", async () => {
    const sql = await journal();
    const untitled = await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      title: "   ",
      body: "First line\nSecond line",
      tags: [],
    });
    expect(untitled.title).toBe("");
    expect(entryLabel(untitled)).toBe("First line");

    const titled = await updateEntry(sql, "note-1", {
      date: "20261028",
      title: "Lantern",
      body: "First line\nSecond line",
      tags: [],
    });
    expect(entryLabel(titled)).toBe("Lantern");
  });

  it("adds a title column when the journal was created without one", async () => {
    const sql = nodeSql();
    await sql.exec(`
      CREATE TABLE entries (
        id TEXT PRIMARY KEY NOT NULL,
        date TEXT NOT NULL,
        body TEXT NOT NULL,
        sync_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    await sql.run(
      `INSERT INTO entries (id, date, body, sync_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["note-1", "20261028", "Already stored.", "pending", "2026-10-28T08:00:00.000Z", "2026-10-28T08:00:00.000Z"],
    );

    await prepareJournal(sql);

    expect(await readEntry(sql, "note-1")).toMatchObject({
      id: "note-1",
      title: "",
      body: "Already stored.",
    });
  });

  it("keeps a note under All and under each of its tags", () => {
    const notes = [
      note("work-only", ["work"]),
      note("both", ["life", "work"]),
      note("untagged", []),
    ];

    expect(ids(entriesForFilter(notes, "all"))).toEqual(["work-only", "both", "untagged"]);
    expect(ids(entriesForFilter(notes, "work"))).toEqual(["work-only", "both"]);
    expect(ids(entriesForFilter(notes, "life"))).toEqual(["both"]);
    expect(entriesForFilter(notes, "thoughts")).toEqual([]);
  });
});

function note(id: string, tags: Entry["tags"]): Entry {
  return {
    id,
    date: "20261029",
    title: "",
    body: id,
    tags,
    syncState: "pending",
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
}

function ids(entries: readonly Entry[]): string[] {
  return entries.map((entry) => entry.id);
}
