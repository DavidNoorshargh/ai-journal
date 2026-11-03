import { prepareJournal, createEntry, deleteEntry, listPendingDeletes, readEntry, updateEntry } from "@/journal/entries";
import { flushOutbox } from "@/journal/flush";
import { nodeSql } from "@/journal/node-sql";
import type { ObjectStore } from "@/journal/object-store";
import type { Sql } from "@/journal/sql";
import { syncJournal } from "@/journal/sync";
import { SessionExpired } from "@/session/cognito";

async function journal(): Promise<Sql> {
  const sql = nodeSql();
  await prepareJournal(sql);
  return sql;
}

function memoryStore(failOn?: string): ObjectStore & { objects: Map<string, string>; removed: string[] } {
  const objects = new Map<string, string>();
  const removed: string[] = [];
  return {
    objects,
    removed,
    async put(key, text) {
      if (key === failOn) {
        throw new Error("Upload failed.");
      }
      objects.set(key, text);
    },
    async remove(key) {
      if (key === failOn) {
        throw new Error("Delete failed.");
      }
      removed.push(key);
      objects.delete(key);
    },
  };
}

describe("flush outbox", () => {
  it("puts both objects and marks the note uploaded", async () => {
    const sql = await journal();
    await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      title: "River walk",
      body: "Revised.",
      tags: ["life"],
    });
    const store = memoryStore();

    await flushOutbox(sql, store);

    expect(store.objects.get("entries/note-1.md")).toBe("# River walk\n\nRevised.");
    expect(JSON.parse(store.objects.get("entries/note-1.md.metadata.json") ?? "")).toEqual({
      metadataAttributes: { entryId: "note-1", date: "20261028", tags: ["life"] },
    });
    expect(await readEntry(sql, "note-1")).toMatchObject({ syncState: "uploaded" });
  });

  it("marks the note failed and keeps it when the put fails", async () => {
    const sql = await journal();
    await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      body: "Still here.",
      tags: ["work"],
    });

    await flushOutbox(sql, memoryStore("entries/note-1.md"));

    expect(await readEntry(sql, "note-1")).toMatchObject({
      syncState: "failed",
      body: "Still here.",
    });
  });

  it("retries a failed note with the same keys", async () => {
    const sql = await journal();
    await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      body: "First.",
      tags: [],
    });
    await flushOutbox(sql, memoryStore("entries/note-1.md"));
    await updateEntry(sql, "note-1", { date: "20261028", body: "Second.", tags: [] });
    const store = memoryStore();

    await flushOutbox(sql, store);

    expect(store.objects.get("entries/note-1.md")).toBe("Second.");
    expect(await readEntry(sql, "note-1")).toMatchObject({ syncState: "uploaded" });
  });

  it("leaves an uploaded note alone", async () => {
    const sql = await journal();
    await createEntry(sql, {
      id: "note-1",
      date: "20261028",
      body: "Already there.",
      tags: [],
      syncState: "uploaded",
    });
    const store = memoryStore();

    await flushOutbox(sql, store);

    expect(store.objects.size).toBe(0);
    expect(await readEntry(sql, "note-1")).toMatchObject({ syncState: "uploaded" });
  });

  it("deletes both objects and clears the pending delete", async () => {
    const sql = await journal();
    await createEntry(sql, { id: "note-1", date: "20261028", body: "Gone.", tags: [] });
    await deleteEntry(sql, "note-1");
    const store = memoryStore();

    await flushOutbox(sql, store);

    expect(store.removed).toEqual(["entries/note-1.md", "entries/note-1.md.metadata.json"]);
    expect(await listPendingDeletes(sql)).toEqual([]);
    expect(await readEntry(sql, "note-1")).toBeNull();
  });

  it("keeps the pending delete when an object delete fails", async () => {
    const sql = await journal();
    await createEntry(sql, { id: "note-1", date: "20261028", body: "Gone.", tags: [] });
    await deleteEntry(sql, "note-1");

    await flushOutbox(sql, memoryStore("entries/note-1.md.metadata.json"));

    expect(await listPendingDeletes(sql)).toEqual(["note-1"]);
  });
});

describe("sync gate", () => {
  it("does not upload while offline", async () => {
    const sql = await journal();
    await createEntry(sql, { id: "note-1", date: "20261028", body: "Waiting.", tags: [] });
    let asked = false;

    const result = await syncJournal(sql, { email: "ada@example.com", refreshToken: "refresh" }, {
      online: async () => false,
      credentials: async () => {
        asked = true;
        throw new Error("should not run");
      },
      store: () => memoryStore(),
    });

    expect(result).toBe("offline");
    expect(asked).toBe(false);
    expect(await readEntry(sql, "note-1")).toMatchObject({ syncState: "pending" });
  });

  it("reports an expired session and leaves the note pending", async () => {
    const sql = await journal();
    await createEntry(sql, { id: "note-1", date: "20261028", body: "Waiting.", tags: [] });

    const result = await syncJournal(sql, { email: "ada@example.com", refreshToken: "refresh" }, {
      online: async () => true,
      credentials: async () => {
        throw new SessionExpired();
      },
      store: () => memoryStore(),
    });

    expect(result).toBe("signed-out");
    expect(await readEntry(sql, "note-1")).toMatchObject({ syncState: "pending" });
  });
});
