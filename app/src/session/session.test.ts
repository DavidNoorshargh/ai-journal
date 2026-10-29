import {
  readSession,
  signIn,
  signOut,
  visibleScreen,
  type SessionStore,
} from "@/session/session";

function memoryStore(): SessionStore & { raw: () => string | null } {
  let value: string | null = null;
  return {
    raw: () => value,
    async get() {
      return value;
    },
    async set(_key, next) {
      value = next;
    },
    async remove() {
      value = null;
    },
  };
}

describe("visibleScreen", () => {
  it("stays on the splash until the keychain has been read", () => {
    expect(visibleScreen({ ready: false, session: null })).toBe("loading");
    expect(
      visibleScreen({ ready: false, session: { email: "ada@example.com" } }),
    ).toBe("loading");
  });

  it("opens on sign-in when no session is stored", () => {
    expect(visibleScreen({ ready: true, session: null })).toBe("sign-in");
  });

  it("opens the notes when a session is stored", () => {
    expect(
      visibleScreen({ ready: true, session: { email: "ada@example.com" } }),
    ).toBe("notes");
  });
});

describe("session store", () => {
  it("stores the email and not the password", async () => {
    const store = memoryStore();
    await signIn(store, " ada@example.com ", "secret-password");
    expect(store.raw()).toBe(JSON.stringify({ email: "ada@example.com" }));
    expect(store.raw()).not.toContain("secret-password");
    expect(await readSession(store)).toEqual({ email: "ada@example.com" });
  });

  it("rejects a blank email or password without writing a session", async () => {
    const store = memoryStore();
    await expect(signIn(store, "  ", "secret-password")).rejects.toThrow(
      "Email and password are required.",
    );
    await expect(signIn(store, "ada@example.com", "")).rejects.toThrow(
      "Email and password are required.",
    );
    expect(store.raw()).toBeNull();
    expect(await readSession(store)).toBeNull();
  });

  it("sign-out clears the stored session", async () => {
    const store = memoryStore();
    await signIn(store, "ada@example.com", "secret-password");
    await signOut(store);
    expect(await readSession(store)).toBeNull();
    expect(visibleScreen({ ready: true, session: await readSession(store) })).toBe(
      "sign-in",
    );
  });

  it("treats a broken stored value as signed out", async () => {
    const store = memoryStore();
    await store.set("session", "not-json");
    expect(await readSession(store)).toBeNull();
  });
});
