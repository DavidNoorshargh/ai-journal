import * as SecureStore from "expo-secure-store";

import { SessionStore } from "@/session/session";

export const secureSessionStore: SessionStore = {
  get(key) {
    return SecureStore.getItemAsync(key);
  },
  set(key, value) {
    return SecureStore.setItemAsync(key, value);
  },
  remove(key) {
    return SecureStore.deleteItemAsync(key);
  },
};
