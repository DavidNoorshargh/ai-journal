import { askBody, invokeAgent, runtimeSessionId, type AgentReply, type AskBody } from "@/journal/ask";
import { listEntries } from "@/journal/entries";
import { openJournal } from "@/journal/open-journal";
import { credentialsFor, SessionExpired } from "@/session/cognito";
import type { Session } from "@/session/session";

export type AskResult = AgentReply | "signed-out";

export async function askOnPhone(session: Session, question: string): Promise<AskResult> {
  const sql = await openJournal();
  const entries = await listEntries(sql);
  return askWithSession(session, askBody(question, entries));
}

async function askWithSession(session: Session, body: AskBody): Promise<AskResult> {
  try {
    const credentials = await credentialsFor(session.refreshToken);
    return invokeAgent(credentials, body, runtimeSessionId());
  } catch (error) {
    if (error instanceof SessionExpired) {
      return "signed-out";
    }
    throw error;
  }
}
