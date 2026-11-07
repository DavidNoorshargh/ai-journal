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

const longCopy = 60;

export function visibleAnswer(answer: string, entries: readonly Entry[] = []): string {
  const withoutThinking = answer.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  const kept = withoutThinking.split("\n").filter((line) => !line.trimStart().startsWith(">"));
  return withoutCopiedSentences(withoutEntryCounts(kept.join("\n")), entries);
}

function withoutEntryCounts(answer: string): string {
  return answer
    .replace(thereAreEntries, "")
    .replace(returnedCount, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function withoutCopiedSentences(answer: string, entries: readonly Entry[]): string {
  const notes = entries.map(noteText).filter((note) => note !== "");
  const kept = sentences(answer).filter((sentence) => !copiesANote(sentence, notes));
  return kept.join(" ").trim();
}

function sentences(answer: string): string[] {
  return answer
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

function copiesANote(sentence: string, notes: readonly string[]): boolean {
  const plainSentence = plain(sentence);
  return notes.some((note) => {
    if (note.length >= 20 && plainSentence.includes(note)) {
      return true;
    }
    if (plainSentence.length >= longCopy && note.includes(plainSentence)) {
      return true;
    }
    return sharesLongSpan(plainSentence, note);
  });
}

function sharesLongSpan(sentence: string, note: string): boolean {
  if (sentence.length < longCopy || note.length < longCopy) {
    return false;
  }
  for (let start = 0; start <= note.length - longCopy; start += 20) {
    if (sentence.includes(note.slice(start, start + longCopy))) {
      return true;
    }
  }
  return false;
}

function noteText(entry: Entry): string {
  const title = entry.title.trim();
  const body = entry.body.trim();
  return plain(title === "" ? body : `${title}\n${body}`);
}

function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
