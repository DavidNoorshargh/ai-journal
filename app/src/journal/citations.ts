import { listDate } from "@/journal/dates";
import { entryLabel, type Entry } from "@/journal/entries";

export type CitedNote = {
  id: string;
  date: string;
  label: string;
};

export function citedNotes(entries: readonly Entry[], ids: readonly string[]): CitedNote[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const notes: CitedNote[] = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry === undefined) {
      continue;
    }
    notes.push({ id: entry.id, date: listDate(entry.date), label: entryLabel(entry) });
  }
  return notes;
}

const returnedCount = /\d+ entr(?:y was|ies were) returned\./gi;
const thereAreEntries = /There (?:is|are) \d+ entr(?:y|ies)\b[^.?!]*[.?!]/gi;

export function visibleAnswer(answer: string): string {
  const withoutThinking = answer.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  const kept = withoutThinking.split("\n").filter((line) => !line.trimStart().startsWith(">"));
  return withoutEntryCounts(kept.join("\n"));
}

function withoutEntryCounts(answer: string): string {
  return answer
    .replace(thereAreEntries, "")
    .replace(returnedCount, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
