import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function AskScreen() {
  const [question, setQuestion] = useState("");

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
      <Pressable testID="ask-send" style={styles.send}>
        <Text style={styles.sendLabel}>Send</Text>
      </Pressable>
    </View>
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
});
