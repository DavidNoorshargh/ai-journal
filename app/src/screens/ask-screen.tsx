import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { Easing, FadeIn, useReducedMotion } from "react-native-reanimated";

import { messageForAskFailure } from "@/journal/ask-failure";
import { askOnPhone } from "@/journal/ask-phone";
import type { CitedNote } from "@/journal/citations";
import { useSession } from "@/session/session-context";

export function AskScreen() {
  const { session, signOut } = useSession();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<CitedNote[]>([]);
  const [sending, setSending] = useState(false);

  async function onSend() {
    const trimmed = question.trim();
    if (trimmed === "") {
      setAnswer(null);
      setCitations([]);
      return;
    }
    if (session === null) {
      return;
    }
    setSending(true);
    try {
      const result = await askOnPhone(session, trimmed);
      if (result === "signed-out") {
        await signOut();
        return;
      }
      setAnswer(result.answer);
      setCitations(result.citations);
    } catch {
      setAnswer(messageForAskFailure());
      setCitations([]);
    } finally {
      setSending(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      testID="ask-screen"
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        testID="ask-question"
        value={question}
        onChangeText={setQuestion}
        multiline
        placeholder="Ask about your notes"
        style={styles.input}
        textAlignVertical="top"
        editable={!sending}
      />
      <Pressable
        testID="ask-send"
        disabled={sending}
        onPress={() => void onSend()}
        style={[styles.send, sending ? styles.sendWaiting : null]}
      >
        <Text style={styles.sendLabel}>Send</Text>
      </Pressable>
      <AskResult sending={sending} answer={answer} citations={citations} />
    </ScrollView>
  );
}

function AskResult({
  sending,
  answer,
  citations,
}: {
  sending: boolean;
  answer: string | null;
  citations: CitedNote[];
}) {
  if (sending) {
    return <Reading />;
  }
  if (answer === null || (answer.trim() === "" && citations.length === 0)) {
    return null;
  }
  return (
    <Animated.View entering={summaryEnter}>
      <AnswerText answer={answer} />
      {citations.map((note) => (
        <CitationLink key={note.id} note={note} />
      ))}
    </Animated.View>
  );
}

const summaryEnter = FadeIn.duration(200).easing(Easing.bezier(0.23, 1, 0.32, 1));

const readingPulse = {
  from: { opacity: 0.35 },
  to: { opacity: 1 },
};

const readingEase = {
  toString: () => "cubicBezier(0.77, 0, 0.175, 1)",
  normalize: () => ({ name: "cubicBezier", x1: 0.77, y1: 0, x2: 0.175, y2: 1 }),
};

function Reading() {
  const reducedMotion = useReducedMotion();
  return (
    <View testID="ask-loading" accessibilityRole="progressbar" style={styles.waiting}>
      <Animated.Text
        style={[
          styles.waitingLabel,
          reducedMotion
            ? undefined
            : {
                animationName: readingPulse,
                animationDuration: 1200,
                animationIterationCount: "infinite",
                animationDirection: "alternate",
                animationTimingFunction: readingEase,
              },
        ]}
      >
        Reading your notes
      </Animated.Text>
    </View>
  );
}

function AnswerText({ answer }: { answer: string | null }) {
  if (answer === null || answer.trim() === "") {
    return null;
  }
  return (
    <Text testID="ask-answer" selectable style={styles.answer}>
      {answer}
    </Text>
  );
}

function CitationLink({ note }: { note: CitedNote }) {
  return (
    <Pressable testID={`ask-citation-${note.id}`} onPress={() => router.push(`/notes/${note.id}`)} style={styles.link}>
      <Text style={styles.linkDate}>{note.date}</Text>
      <Text style={styles.linkLabel}>{note.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: 12,
    padding: 20,
  },
  input: {
    borderColor: "#cccccc",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  send: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderCurve: "continuous",
    borderRadius: 8,
    paddingVertical: 12,
  },
  sendWaiting: {
    opacity: 0.4,
  },
  waiting: {
    marginTop: 8,
  },
  waitingLabel: {
    color: "#5c5c5c",
    fontSize: 16,
  },
  sendLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  answer: {
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
  },
  link: {
    borderBottomColor: "#dddddd",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  linkDate: {
    color: "#5c5c5c",
    fontSize: 13,
  },
  linkLabel: {
    color: "#0b57d0",
    flex: 1,
    fontSize: 16,
    textDecorationLine: "underline",
  },
});
