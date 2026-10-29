import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "@/session/session-context";

export function SignInScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} testID="sign-in-screen">
      <View style={styles.form}>
        <Text style={styles.title}>My AI Journal</Text>
        <TextInput
          testID="sign-in-email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Email"
          style={styles.input}
          textContentType="username"
        />
        <TextInput
          testID="sign-in-password"
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          textContentType="password"
        />
        {error === null ? null : (
          <Text testID="sign-in-error" style={styles.error}>
            {error}
          </Text>
        )}
        <Pressable
          testID="sign-in-submit"
          disabled={submitting}
          onPress={onSubmit}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  form: {
    flex: 1,
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cccccc",
    borderRadius: 8,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: {
    color: "#b00020",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderRadius: 8,
    marginTop: 8,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
