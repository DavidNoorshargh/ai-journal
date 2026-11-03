import { deletedEntryKeys, entryDocuments } from "@/journal/documents";
import {
  clearPendingDelete,
  listEntries,
  listPendingDeletes,
  markFailed,
  markUploaded,
  readEntry,
  type Entry,
} from "@/journal/entries";
import type { ObjectStore } from "@/journal/object-store";
import type { Sql } from "@/journal/sql";

export async function flushOutbox(sql: Sql, store: ObjectStore): Promise<void> {
  await uploadWaiting(sql, store);
  await removeWaiting(sql, store);
}

async function uploadWaiting(sql: Sql, store: ObjectStore): Promise<void> {
  const entries = await listEntries(sql);
  for (const entry of entries) {
    if (entry.syncState === "uploaded") {
      continue;
    }
    await uploadEntry(sql, store, entry);
  }
}

async function uploadEntry(sql: Sql, store: ObjectStore, entry: Entry): Promise<void> {
  const documents = entryDocuments(entry);
  try {
    await store.put(documents.markdown.key, documents.markdown.text);
    await store.put(documents.sidecar.key, documents.sidecar.text);
    await markUploaded(sql, entry.id);
  } catch {
    await markFailedIfPresent(sql, entry.id);
  }
}

async function markFailedIfPresent(sql: Sql, id: string): Promise<void> {
  const current = await readEntry(sql, id);
  if (current === null) {
    return;
  }
  await markFailed(sql, id);
}

async function removeWaiting(sql: Sql, store: ObjectStore): Promise<void> {
  const ids = await listPendingDeletes(sql);
  for (const id of ids) {
    await removeDeleted(sql, store, id);
  }
}

async function removeDeleted(sql: Sql, store: ObjectStore, id: string): Promise<void> {
  try {
    for (const key of deletedEntryKeys(id)) {
      await store.remove(key);
    }
    await clearPendingDelete(sql, id);
  } catch {
    return;
  }
}
