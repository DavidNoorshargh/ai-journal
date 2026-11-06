import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { askOnPhone } from "@/journal/ask-phone";
import { useSession } from "@/session/session-context";

export function AskScreen() {
  const { session, signOut } = useSession();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSend() {
    const trimmed = question.trim();
    if (trimmed === "") {
      setAnswer(null);
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
    } catch (error) {
      setAnswer(askError(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.screen} testID="ask-screen">
      <TextInput
        testID="ask-question"
        value={question}
        onChangeText={setQuestion}
        multiline
        placeholder="Ask about your notes"
        style={styles.input}
        textAlignVertical="top"
      />
      <Pressable testID="ask-send" disabled={sending} onPress={() => void onSend()} style={styles.send}>
        <Text style={styles.sendLabel}>Send</Text>
      </Pressable>
      <AnswerText answer={answer} />
    </View>
  );
}

function askError(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }
  return "Ask failed.";
}

function AnswerText({ answer }: { answer: string | null }) {
  if (answer === null) {
    return null;
  }
  return (
    <Text testID="ask-answer" style={styles.answer}>
      {answer}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 12,
    padding: 20,
  },
  input: {
    borderColor: "#cccccc",
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
    borderRadius: 8,
    paddingVertical: 12,
  },
  sendLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  answer: {
    fontSize: 16,
    lineHeight: 22,
  },
});
