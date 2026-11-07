import { createEntry, listEntries, listPendingDeletes } from "@/journal/entries";
import type { ObjectStore } from "@/journal/object-store";
import type { Sql } from "@/journal/sql";
import { TAGS, type Tag } from "@/journal/tags";

type RestoredNote = {
  id: string;
  date: string;
  title: string;
  body: string;
  tags: Tag[];
};

export async function restoreUploadedNotes(sql: Sql, store: ObjectStore): Promise<void> {
  if (!(await journalIsEmpty(sql))) {
    return;
  }
  for (const note of await uploadedNotes(store)) {
    await createEntry(sql, { ...note, syncState: "uploaded" });
  }
}

async function journalIsEmpty(sql: Sql): Promise<boolean> {
  const entries = await listEntries(sql);
  const deletes = await listPendingDeletes(sql);
  return entries.length === 0 && deletes.length === 0;
}

async function uploadedNotes(store: ObjectStore): Promise<RestoredNote[]> {
  const keys = await store.list("entries/");
  const notes: RestoredNote[] = [];
  for (const key of markdownKeys(keys)) {
    const note = await noteFrom(store, key);
    if (note !== null) {
      notes.push(note);
    }
  }
  return notes;
}

function markdownKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => key.endsWith(".md"));
}

async function noteFrom(store: ObjectStore, key: string): Promise<RestoredNote | null> {
  const id = entryId(key);
  if (id === null) {
    return null;
  }
  const markdown = await store.get(key);
  const sidecar = await store.get(`${key}.metadata.json`);
  if (markdown === null || sidecar === null) {
    return null;
  }
  return restoredNote(id, markdown, sidecar);
}

function entryId(key: string): string | null {
  const match = key.match(/^entries\/(.+)\.md$/);
  return match?.[1] ?? null;
}

export function restoredNote(id: string, markdown: string, sidecar: string): RestoredNote | null {
  const fields = sidecarFields(sidecar);
  const text = titleAndBody(markdown);
  if (fields === null || text === null || !/^\d{8}$/.test(fields.date)) {
    return null;
  }
  return {
    id,
    date: fields.date,
    title: text.title,
    body: text.body,
    tags: knownTags(fields.tags),
  };
}

function sidecarFields(sidecar: string): { date: string; tags: string[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sidecar);
  } catch {
    return null;
  }
  const attributes = record(parsed)?.metadataAttributes;
  const date = textValue(record(attributes)?.date);
  const tags = listValue(record(attributes)?.tags);
  if (date === null || tags === null) {
    return null;
  }
  return { date, tags };
}

function titleAndBody(markdown: string): { title: string; body: string } | null {
  const heading = markdown.match(/^# ([^\n]+)\n\n([\s\S]*)$/);
  if (heading !== null) {
    if (heading[2].trim() === "") {
      return null;
    }
    return { title: heading[1].trim(), body: heading[2] };
  }
  if (markdown.trim() === "") {
    return null;
  }
  return { title: "", body: markdown };
}

function knownTags(tags: readonly string[]): Tag[] {
  const cleaned = tags.map((tag) => tag.trim().replaceAll(/^"|"$/g, ""));
  return TAGS.filter((tag) => cleaned.includes(tag));
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  const typed = record(record(value)?.value)?.stringValue;
  return typeof typed === "string" ? typed : null;
}

function listValue(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  const typed = record(record(value)?.value)?.stringListValue;
  if (Array.isArray(typed) && typed.every((item) => typeof item === "string")) {
    return typed;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
