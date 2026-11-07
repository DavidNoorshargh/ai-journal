import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";

import { syncJournal, type SyncResult } from "@/journal/sync";
import { s3ObjectStore } from "@/journal/s3";
import type { Sql } from "@/journal/sql";
import { credentialsFor } from "@/session/cognito";
import type { Session } from "@/session/session";

export async function syncOnPhone(sql: Sql, session: Session): Promise<SyncResult> {
  return syncJournal(sql, session, {
    online: phoneIsOnline,
    credentials: credentialsFor,
    store: s3ObjectStore,
  });
}

export function watchConnection(onOnline: () => void): { remove: () => void } {
  return addNetworkStateListener((state) => {
    if (state.isConnected === true && state.isInternetReachable !== false) {
      onOnline();
    }
  });
}

export async function phoneIsOnline(): Promise<boolean> {
  const state = await getNetworkStateAsync();
  return state.isConnected === true && state.isInternetReachable !== false;
}
