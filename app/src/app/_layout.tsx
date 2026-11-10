import { useEffect } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { openJournal } from "@/journal/open-journal";
import { syncOnPhone, watchConnection } from "@/journal/phone-sync";
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
      <KeyboardProvider>
        <SessionProvider>
          <UploadOnForeground />
          <RootStack />
        </SessionProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function UploadOnForeground() {
  const { session, signOut } = useSession();

  useEffect(() => {
    if (session === null) {
      return;
    }
    let cancelled = false;
    const run = () => {
      openJournal()
        .then((sql) => syncOnPhone(sql, session))
        .then((result) => {
          if (!cancelled && result === "signed-out") {
            return signOut();
          }
        })
        .catch((error: unknown) => {
          console.warn(error);
        });
    };
    run();
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        run();
      }
    });
    const connection = watchConnection(run);
    return () => {
      cancelled = true;
      app.remove();
      connection.remove();
    };
  }, [session, signOut]);

  return null;
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
