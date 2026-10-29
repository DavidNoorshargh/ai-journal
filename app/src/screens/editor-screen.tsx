import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { fieldDate, storedDate, todayFieldDate } from "@/journal/dates";
import { createEntry, deleteEntry, readEntry, updateEntry } from "@/journal/entries";
import { openJournal } from "@/journal/open-journal";
import { TAGS, type Tag } from "@/journal/tags";

export function EditorScreen({ mode, noteId }: { mode: "new" | "edit"; noteId?: string }) {
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
    let cancelled = false;
    openJournal()
      .then((sql) => readEntry(sql, noteId))
      .then((entry) => {
        if (cancelled) {
          return;
        }
        if (entry === null) {
          setError("Note not found.");
        } else {
          setTitle(entry.title);
          setDate(fieldDate(entry.date));
          setBody(entry.body);
          setSelected(entry.tags);
        }
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "The note could not be opened.");
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, noteId]);

  function toggle(tag: Tag) {
    setSelected((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const sql = await openJournal();
      const stored = storedDate(date);
      if (mode === "edit" && noteId) {
        await updateEntry(sql, noteId, { date: stored, title, body, tags: selected });
      } else {
        await createEntry(sql, { date: stored, title, body, tags: selected });
      }
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
      setSaving(false);
    }
  }

  async function onDelete() {
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
      setError(caught instanceof Error ? caught.message : "Delete failed.");
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="editor-screen">
      <TextInput
        testID="editor-title"
        value={title}
        onChangeText={setTitle}
        placeholder="Title"
        style={styles.input}
      />
      <TextInput
        testID="editor-date"
        value={date}
        onChangeText={setDate}
        style={styles.input}
      />
      <TextInput
        testID="editor-body"
        value={body}
        onChangeText={setBody}
        multiline
        placeholder="Write a note"
        style={[styles.input, styles.body]}
        textAlignVertical="top"
      />
      <View style={styles.tags}>
        {TAGS.map((tag) => {
          const on = selected.includes(tag);
          return (
            <Pressable
              key={tag}
              testID={`editor-tag-${tag}`}
              onPress={() => toggle(tag)}
              style={[styles.chip, on ? styles.chipSelected : null]}
            >
              <Text style={on ? styles.chipLabelSelected : styles.chipLabel}>{tag}</Text>
            </Pressable>
          );
        })}
      </View>
      {error === null ? null : (
        <Text testID="editor-error" style={styles.error}>
          {error}
        </Text>
      )}
      <Pressable
        testID="editor-save"
        disabled={!ready || saving}
        onPress={onSave}
        style={styles.save}
      >
        <Text style={styles.saveLabel}>Save</Text>
      </Pressable>
      {mode === "edit" ? (
        <Pressable
          testID="editor-delete"
          disabled={!ready || saving}
          onPress={onDelete}
          style={styles.delete}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
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
