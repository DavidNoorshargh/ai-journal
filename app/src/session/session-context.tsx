import { createContext, use, useEffect, useState, type ReactNode } from "react";

import { secureSessionStore } from "@/session/secure-session-store";
import {
  readSession,
  signIn as storeSignIn,
  signOut as storeSignOut,
  type Session,
  type SessionStore,
} from "@/session/session";

type SessionContextValue = {
  ready: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  store = secureSessionStore,
}: {
  children: ReactNode;
  store?: SessionStore;
}) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    readSession(store).then((next) => {
      if (cancelled) {
        return;
      }
      setSession(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  async function signIn(email: string, password: string) {
    await storeSignIn(store, email, password);
    setSession(await readSession(store));
    setReady(true);
  }

  async function signOut() {
    await storeSignOut(store);
    setSession(null);
    setReady(true);
  }

  return (
    <SessionContext value={{ ready, session, signIn, signOut }}>
      {children}
    </SessionContext>
  );
}

export function useSession() {
  const value = use(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return value;
}
