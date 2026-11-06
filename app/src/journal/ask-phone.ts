import { askBody, invokeAgent, runtimeSessionId, type AgentReply, type AskBody } from "@/journal/ask";
import { citedNotes, visibleAnswer, type CitedNote } from "@/journal/citations";
import { listEntries } from "@/journal/entries";
import { openJournal } from "@/journal/open-journal";
import { credentialsFor, SessionExpired } from "@/session/cognito";
import type { Session } from "@/session/session";

export type PhoneAnswer = {
  answer: string;
  citations: CitedNote[];
};

export type AskResult = PhoneAnswer | "signed-out";

export async function askOnPhone(session: Session, question: string): Promise<AskResult> {
  const sql = await openJournal();
  const entries = await listEntries(sql);
  const reply = await askWithSession(session, askBody(question, entries));
  if (reply === "signed-out") {
    return reply;
  }
  return { answer: visibleAnswer(reply.answer), citations: citedNotes(entries, reply.entryIds) };
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
