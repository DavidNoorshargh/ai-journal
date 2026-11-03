import type { AwsCredentials } from "@/session/cognito";
import { SessionExpired } from "@/session/cognito";
import { flushOutbox } from "@/journal/flush";
import type { ObjectStore } from "@/journal/object-store";
import type { Sql } from "@/journal/sql";
import type { Session } from "@/session/session";

export type SyncResult = "flushed" | "offline" | "signed-out";

export type SyncDeps = {
  online: () => Promise<boolean>;
  credentials: (refreshToken: string) => Promise<AwsCredentials>;
  store: (credentials: AwsCredentials) => ObjectStore;
};

export async function syncJournal(sql: Sql, session: Session, deps: SyncDeps): Promise<SyncResult> {
  if (!(await deps.online())) {
    return "offline";
  }
  try {
    const credentials = await deps.credentials(session.refreshToken);
    await flushOutbox(sql, deps.store(credentials));
    return "flushed";
  } catch (error) {
    if (error instanceof SessionExpired) {
      return "signed-out";
    }
    throw error;
  }
}
