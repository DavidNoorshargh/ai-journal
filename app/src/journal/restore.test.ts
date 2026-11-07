import { createEntry, deleteEntry, listEntries, prepareJournal } from "@/journal/entries";
import { nodeSql } from "@/journal/node-sql";
import type { ObjectStore } from "@/journal/object-store";
import { restoredNote, restoreUploadedNotes } from "@/journal/restore";
import type { Sql } from "@/journal/sql";
import { syncJournal } from "@/journal/sync";

const sidecar = JSON.stringify({
  metadataAttributes: {
    entryId: "note-1",
    date: "20261106",
    tags: ["work", "learnings"],
  },
});

async function journal(): Promise<Sql> {
  const sql = nodeSql();
  await prepareJournal(sql);
  return sql;
}

function cloud(objects: Record<string, string>): ObjectStore & { puts: string[] } {
  const stored = new Map(Object.entries(objects));
  const puts: string[] = [];
  return {
    puts,
    async put(key, text) {
      puts.push(key);
      stored.set(key, text);
    },
    async remove() {
      return undefined;
    },
    async list(prefix) {
      return [...stored.keys()].filter((key) => key.startsWith(prefix));
    },
    async get(key) {
      return stored.get(key) ?? null;
    },
  };
}

describe("restore uploaded notes", () => {
  it("copies an empty journal from the uploaded notes and does not upload them again", async () => {
    const sql = await journal();
    const store = cloud({
      "entries/note-1.md": "# River walk\n\nRevised.",
      "entries/note-1.md.metadata.json": sidecar,
    });

    await syncJournal(sql, { email: "ada@example.com", refreshToken: "refresh" }, {
      online: async () => true,
      credentials: async () => ({
        accessKeyId: "key",
        secretAccessKey: "secret",
        sessionToken: "token",
      }),
      store: () => store,
    });

    expect(await listEntries(sql)).toEqual([
      expect.objectContaining({
        id: "note-1",
        date: "20261106",
        title: "River walk",
        body: "Revised.",
        tags: ["work", "learnings"],
        syncState: "uploaded",
      }),
    ]);
    expect(store.puts).toEqual([]);
  });

  it("leaves a journal that already has a note alone", async () => {
    const sql = await journal();
    await createEntry(sql, { id: "local", date: "20261106", body: "Already here.", tags: [] });
    let listed = false;

    await restoreUploadedNotes(sql, {
      async list() {
        listed = true;
        return [];
      },
      async get() {
        return null;
      },
      async put() {
        return undefined;
      },
      async remove() {
        return undefined;
      },
    });

    expect(listed).toBe(false);
    expect((await listEntries(sql)).map((entry) => entry.id)).toEqual(["local"]);
  });

  it("does not bring back a note that this phone is still deleting", async () => {
    const sql = await journal();
    await createEntry(sql, { id: "gone", date: "20261106", body: "Gone.", tags: [] });
    await deleteEntry(sql, "gone");
    let listed = false;

    await restoreUploadedNotes(sql, {
      async list() {
        listed = true;
        return ["entries/gone.md"];
      },
      async get() {
        return "Gone.";
      },
      async put() {
        return undefined;
      },
      async remove() {
        return undefined;
      },
    });

    expect(listed).toBe(false);
    expect(await listEntries(sql)).toEqual([]);
  });

  it("reads a blank title and a typed sidecar", () => {
    const note = restoredNote(
      "fixture-retrieval",
      "The fixture entry is about a blue paper lantern.",
      JSON.stringify({
        metadataAttributes: {
          date: { value: { type: "STRING", stringValue: "20261024" } },
          tags: { value: { type: "STRING_LIST", stringListValue: ['"thoughts"'] } },
        },
      }),
    );

    expect(note).toEqual({
      id: "fixture-retrieval",
      date: "20261024",
      title: "",
      body: "The fixture entry is about a blue paper lantern.",
      tags: ["thoughts"],
    });
  });
});
