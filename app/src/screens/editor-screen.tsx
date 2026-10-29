import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { fieldDate, storedDate, todayFieldDate } from "@/journal/dates";
import { createEntry, deleteEntry, readEntry, updateEntry } from "@/journal/entries";
import { openJournal } from "@/journal/open-journal";
import { TAGS, type Tag } from "@/journal/tags";

type EditorMode = "new" | "edit";

export function EditorScreen({ mode, noteId }: { mode: EditorMode; noteId?: string }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayFieldDate);
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(mode === "new");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !noteId) {
      return;
    }
    return fillEditor(noteId, { setTitle, setDate, setBody, setSelected, setError, setReady });
  }, [mode, noteId]);

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="editor-screen">
      <NoteFields
        title={title}
        date={date}
        body={body}
        selected={selected}
        onTitle={setTitle}
        onDate={setDate}
        onBody={setBody}
        onToggleTag={toggleTag(setSelected)}
      />
      <EditorError message={error} />
      <SaveButton
        disabled={!ready || saving}
        onPress={() =>
          storeNote({ mode, noteId, title, date, body, tags: selected, setError, setSaving })
        }
      />
      {mode === "edit" ? (
        <DeleteButton
          disabled={!ready || saving}
          onPress={() => removeNote(noteId, setError, setSaving)}
        />
      ) : null}
    </ScrollView>
  );
}

function NoteFields({
  title,
  date,
  body,
  selected,
  onTitle,
  onDate,
  onBody,
  onToggleTag,
}: {
  title: string;
  date: string;
  body: string;
  selected: readonly Tag[];
  onTitle: (value: string) => void;
  onDate: (value: string) => void;
  onBody: (value: string) => void;
  onToggleTag: (tag: Tag) => void;
}) {
  return (
    <>
      <TextInput
        testID="editor-title"
        value={title}
        onChangeText={onTitle}
        placeholder="Title"
        style={styles.input}
      />
      <TextInput testID="editor-date" value={date} onChangeText={onDate} style={styles.input} />
      <TextInput
        testID="editor-body"
        value={body}
        onChangeText={onBody}
        multiline
        placeholder="Write a note"
        style={[styles.input, styles.body]}
        textAlignVertical="top"
      />
      <TagChoices selected={selected} onToggle={onToggleTag} />
    </>
  );
}

function TagChoices({
  selected,
  onToggle,
}: {
  selected: readonly Tag[];
  onToggle: (tag: Tag) => void;
}) {
  return (
    <View style={styles.tags}>
      {TAGS.map((tag) => (
        <TagChoice key={tag} tag={tag} selected={selected.includes(tag)} onToggle={onToggle} />
      ))}
    </View>
  );
}

function TagChoice({
  tag,
  selected,
  onToggle,
}: {
  tag: Tag;
  selected: boolean;
  onToggle: (tag: Tag) => void;
}) {
  return (
    <Pressable
      testID={`editor-tag-${tag}`}
      onPress={() => onToggle(tag)}
      style={[styles.chip, selected ? styles.chipSelected : null]}
    >
      <Text style={selected ? styles.chipLabelSelected : styles.chipLabel}>{tag}</Text>
    </Pressable>
  );
}

function EditorError({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <Text testID="editor-error" style={styles.error}>
      {message}
    </Text>
  );
}

function SaveButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable testID="editor-save" disabled={disabled} onPress={onPress} style={styles.save}>
      <Text style={styles.saveLabel}>Save</Text>
    </Pressable>
  );
}

function DeleteButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable testID="editor-delete" disabled={disabled} onPress={onPress} style={styles.delete}>
      <Text style={styles.deleteLabel}>Delete</Text>
    </Pressable>
  );
}

function toggleTag(setSelected: (update: (current: Tag[]) => Tag[]) => void): (tag: Tag) => void {
  return (tag) => {
    setSelected((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };
}

type EditorFields = {
  setTitle: (value: string) => void;
  setDate: (value: string) => void;
  setBody: (value: string) => void;
  setSelected: (value: Tag[]) => void;
  setError: (value: string | null) => void;
  setReady: (value: boolean) => void;
};

function fillEditor(noteId: string, fields: EditorFields): () => void {
  let cancelled = false;
  openJournal()
    .then((sql) => readEntry(sql, noteId))
    .then((entry) => {
      if (cancelled) {
        return;
      }
      showLoadedNote(entry, fields);
    })
    .catch((caught: unknown) => {
      if (!cancelled) {
        fields.setError(errorMessage(caught, "The note could not be opened."));
        fields.setReady(true);
      }
    });
  return () => {
    cancelled = true;
  };
}

function showLoadedNote(
  entry: Awaited<ReturnType<typeof readEntry>>,
  fields: EditorFields,
): void {
  if (entry === null) {
    fields.setError("Note not found.");
  } else {
    fields.setTitle(entry.title);
    fields.setDate(fieldDate(entry.date));
    fields.setBody(entry.body);
    fields.setSelected(entry.tags);
  }
  fields.setReady(true);
}

async function storeNote(note: {
  mode: EditorMode;
  noteId?: string;
  title: string;
  date: string;
  body: string;
  tags: readonly Tag[];
  setError: (value: string | null) => void;
  setSaving: (value: boolean) => void;
}): Promise<void> {
  note.setSaving(true);
  note.setError(null);
  try {
    const sql = await openJournal();
    await writeNote(sql, note);
    router.back();
  } catch (caught) {
    note.setError(errorMessage(caught, "Save failed."));
    note.setSaving(false);
  }
}

async function writeNote(
  sql: Awaited<ReturnType<typeof openJournal>>,
  note: {
    mode: EditorMode;
    noteId?: string;
    title: string;
    date: string;
    body: string;
    tags: readonly Tag[];
  },
): Promise<void> {
  const date = storedDate(note.date);
  if (note.mode === "edit" && note.noteId) {
    await updateEntry(sql, note.noteId, {
      date,
      title: note.title,
      body: note.body,
      tags: note.tags,
    });
    return;
  }
  await createEntry(sql, { date, title: note.title, body: note.body, tags: note.tags });
}

async function removeNote(
  noteId: string | undefined,
  setError: (value: string | null) => void,
  setSaving: (value: boolean) => void,
): Promise<void> {
  if (!noteId) {
    return;
  }
  setSaving(true);
  setError(null);
  try {
    const sql = await openJournal();
    await deleteEntry(sql, noteId);
    router.back();
  } catch (caught) {
    setError(errorMessage(caught, "Delete failed."));
    setSaving(false);
  }
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

const styles = StyleSheet.create({
  screen: {
    gap: 12,
    padding: 20,
  },
  input: {
    borderColor: "#cccccc",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  body: {
    minHeight: 160,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderColor: "#cccccc",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: "#111111",
    borderColor: "#111111",
  },
  chipLabel: {
    fontSize: 14,
  },
  chipLabelSelected: {
    color: "#ffffff",
    fontSize: 14,
  },
  error: {
    color: "#b00020",
  },
  save: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderRadius: 8,
    paddingVertical: 12,
  },
  saveLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  delete: {
    alignItems: "center",
    paddingVertical: 12,
  },
  deleteLabel: {
    color: "#b00020",
    fontSize: 16,
  },
});
