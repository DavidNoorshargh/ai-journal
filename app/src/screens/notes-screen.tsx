import { useCallback, useEffect, useState } from "react";
import { AppState, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { listDate } from "@/journal/dates";
import { entriesForFilter, entryLabel, listEntries, type Entry, type SyncState } from "@/journal/entries";
import { openJournal } from "@/journal/open-journal";
import { syncOnPhone, watchConnection } from "@/journal/phone-sync";
import { TAGS, type Tag } from "@/journal/tags";
import { useSession } from "@/session/session-context";

type Filter = "all" | Tag;

const SYNC_LABEL: Record<SyncState, string> = {
  pending: "On the phone",
  uploaded: "Uploaded",
  failed: "Failed",
};

export function NotesScreen() {
  const { signOut, session } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [ready, setReady] = useState(false);
  const visible = entriesForFilter(entries, filter);
  const reload = useCallback(() => {
    let cancelled = false;
    openJournal()
      .then(async (sql) => {
        if (session !== null) {
          const result = await syncOnPhone(sql, session);
          if (cancelled) {
            return null;
          }
          if (result === "signed-out") {
            await signOut();
            return null;
          }
        }
        return listEntries(sql);
      })
      .then((rows) => {
        if (cancelled || rows == null) {
          return;
        }
        setEntries(rows);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, signOut]);

  useFocusEffect(
    useCallback(() => {
      return reload();
    }, [reload]),
  );
  useUploadTriggers(reload);

  return (
    <SafeAreaView style={styles.safe} testID="notes-screen">
      <View style={styles.header}>
        <Text style={styles.title}>My AI Journal</Text>
        <Pressable testID="notes-sign-out" onPress={() => signOut()}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable
          testID="notes-write"
          onPress={() => router.push("/notes/new")}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>Write</Text>
        </Pressable>
        <Pressable
          testID="notes-ask"
          onPress={() => router.push("/ask")}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>Ask</Text>
        </Pressable>
      </View>
      <View style={styles.tags}>
        <TagChip
          testID="notes-tag-all"
          label="All"
          selected={filter === "all"}
          onPress={() => setFilter("all")}
        />
        {TAGS.map((tag) => (
          <TagChip
            key={tag}
            testID={`notes-tag-${tag}`}
            label={tag}
            selected={filter === tag}
            onPress={() => setFilter(tag)}
          />
        ))}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(entry) => entry.id}
        style={styles.list}
        ListEmptyComponent={
          ready ? (
            <Text testID="notes-empty" style={styles.empty}>
              {filter === "all" ? "No entries yet" : "No notes for this tag"}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => <NoteRow item={item} onRetry={reload} />}
      />
    </SafeAreaView>
  );
}

function NoteRow({ item, onRetry }: { item: Entry; onRetry: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable testID={`notes-row-${item.id}`} onPress={() => router.push(`/notes/${item.id}`)}>
        <View style={styles.rowHeader}>
          <Text style={styles.date}>{listDate(item.date)}</Text>
          <Text style={styles.sync}>{SYNC_LABEL[item.syncState]}</Text>
        </View>
        <Text style={styles.label}>{entryLabel(item)}</Text>
        <Text style={styles.rowTags}>{item.tags.join(" ")}</Text>
      </Pressable>
      {item.syncState === "failed" ? (
        <Pressable testID={`notes-retry-${item.id}`} onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function useUploadTriggers(reload: () => () => void) {
  useEffect(() => {
    let cancel = () => {};
    const run = () => {
      cancel();
      cancel = reload();
    };
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        run();
      }
    });
    const connection = watchConnection(run);
    return () => {
      cancel();
      app.remove();
      connection.remove();
    };
  }, [reload]);
}

function TagChip({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipSelected : null]}
    >
      <Text style={selected ? styles.chipLabelSelected : styles.chipLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
  signOut: {
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  action: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderRadius: 8,
    flex: 1,
    paddingVertical: 12,
  },
  actionLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
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
  list: {
    flex: 1,
    marginTop: 8,
  },
  row: {
    borderTopColor: "#dddddd",
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  date: {
    fontSize: 13,
  },
  sync: {
    fontSize: 13,
  },
  label: {
    fontSize: 16,
    marginTop: 4,
  },
  rowTags: {
    fontSize: 13,
    marginTop: 4,
  },
  retry: {
    alignSelf: "flex-start",
    marginTop: 8,
  },
  retryLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  empty: {
    marginTop: 32,
    textAlign: "center",
  },
});
