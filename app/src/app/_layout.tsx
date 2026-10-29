import { useEffect } from "react";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { openJournal } from "@/journal/open-journal";
import { SessionProvider, useSession } from "@/session/session-context";
import { visibleScreen } from "@/session/session";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    openJournal().catch((error: unknown) => {
      console.warn(error);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <RootStack />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function RootStack() {
  const { ready, session } = useSession();
  const screen = visibleScreen({ ready, session });

  useEffect(() => {
    if (screen !== "loading") {
      SplashScreen.hideAsync();
    }
  }, [screen]);

  if (screen === "loading") {
    return null;
  }

  const signedIn = screen === "notes";

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal", headerShadowVisible: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ headerShown: false, title: "My AI Journal" }} />
        <Stack.Screen name="notes/new" options={{ title: "Write" }} />
        <Stack.Screen name="notes/[id]" options={{ title: "Note" }} />
        <Stack.Screen name="ask" options={{ title: "Ask" }} />
      </Stack.Protected>
    </Stack>
  );
}
