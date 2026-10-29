export type Session = {
  email: string;
};

export type SessionStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type GateScreen = "loading" | "sign-in" | "notes";

const SESSION_KEY = "session";

export function visibleScreen(state: {
  ready: boolean;
  session: Session | null;
}): GateScreen {
  if (!state.ready) {
    return "loading";
  }
  return state.session === null ? "sign-in" : "notes";
}

export async function readSession(store: SessionStore): Promise<Session | null> {
  let raw: string | null;
  try {
    raw = await store.get(SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { email?: unknown };
    if (typeof parsed.email !== "string" || parsed.email === "") {
      return null;
    }
    return { email: parsed.email };
  } catch {
    return null;
  }
}

// The password is checked for presence and is not stored. Cognito replaces
// this check when the phone starts calling AWS.
export async function signIn(
  store: SessionStore,
  email: string,
  password: string,
): Promise<void> {
  const trimmed = email.trim();
  if (trimmed === "" || password === "") {
    throw new Error("Email and password are required.");
  }
  await store.set(SESSION_KEY, JSON.stringify({ email: trimmed }));
}

export async function signOut(store: SessionStore): Promise<void> {
  await store.remove(SESSION_KEY);
}
