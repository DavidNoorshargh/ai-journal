import { askBody, invokeAgent, runtimeSessionId, type AgentReply, type AskBody } from "@/journal/ask";
import { askNeedsConnection } from "@/journal/ask-failure";
import { citedNotes, visibleAnswer, type CitedNote } from "@/journal/citations";
import { listEntries } from "@/journal/entries";
import { openJournal } from "@/journal/open-journal";
import { phoneIsOnline } from "@/journal/phone-sync";
import { credentialsFor, SessionExpired } from "@/session/cognito";
import type { Session } from "@/session/session";

export type PhoneAnswer = {
  answer: string;
  citations: CitedNote[];
};

export type AskResult = PhoneAnswer | "signed-out";

export async function askOnPhone(
  session: Session,
  question: string,
  online: () => Promise<boolean> = phoneIsOnline,
): Promise<AskResult> {
  if (!(await online())) {
    throw new Error(askNeedsConnection);
  }
  const sql = await openJournal();
  const entries = await listEntries(sql);
  const reply = await askWithSession(session, askBody(question, entries));
  if (reply === "signed-out") {
    return reply;
  }
  const citations = citedNotes(entries, reply.entryIds);
  const returned = entries.filter((entry) => citations.some((note) => note.id === entry.id));
  return { answer: visibleAnswer(reply.answer, returned), citations };
}

async function askWithSession(session: Session, body: AskBody): Promise<AgentReply | "signed-out"> {
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
