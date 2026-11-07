import { citedNotes, visibleAnswer } from "@/journal/citations";
import type { Entry } from "@/journal/entries";

const interview: Entry = {
  id: "note-1",
  date: "20261106",
  title: "SDET interview",
  body: "The conversation.",
  tags: ["work"],
  syncState: "uploaded",
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
};

describe("cited notes", () => {
  it("links a returned note by its date and title, and skips a note that is not on the phone", () => {
    expect(citedNotes([interview], ["missing", "note-1"])).toEqual([
      { id: "note-1", date: "6 Nov", label: "SDET interview" },
    ]);
  });

  it("uses the first line of the body when the title is blank", () => {
    const untitled = { ...interview, title: "", body: "First line\nSecond line" };
    expect(citedNotes([untitled], ["note-1"])[0].label).toBe("First line");
  });

  it("leaves a thinking block out of the summary", () => {
    expect(visibleAnswer("<thinking>Private.</thinking>\nOne note matches.")).toBe("One note matches.");
  });

  it("leaves a quoted note out of the summary", () => {
    expect(visibleAnswer("One note matches.\n> The whole note.")).toBe("One note matches.");
  });

  it("leaves a long copy of a note out of the summary", () => {
    const note = {
      ...interview,
      body: "Today I had an initial interview with a company called MillTech for an SDET role and the salary was low.",
    };
    const answer = `You were overqualified for the role. ${note.body}`;
    expect(visibleAnswer(answer, [note])).toBe("You were overqualified for the role.");
  });

  it("leaves the entry count out of the summary", () => {
    const answer = "The note records an interview. There is 1 entry about your interview today.\n1 entry was returned.";
    expect(visibleAnswer(answer)).toBe("The note records an interview.");
  });
});
