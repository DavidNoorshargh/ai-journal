import { deletedEntryKeys, entryDocuments } from "@/journal/documents";

const note = {
  id: "note-1",
  date: "20261028",
  title: "River walk",
  body: "Revised.",
  tags: ["life", "work"],
};

describe("entry documents", () => {
  it("starts a titled note with a heading and stores the filter fields beside it", () => {
    const documents = entryDocuments(note);

    expect(documents.markdown).toEqual({
      key: "entries/note-1.md",
      text: "# River walk\n\nRevised.",
    });
    expect(documents.sidecar.key).toBe("entries/note-1.md.metadata.json");
    expect(JSON.parse(documents.sidecar.text)).toEqual({
      metadataAttributes: {
        entryId: "note-1",
        date: "20261028",
        tags: ["life", "work"],
      },
    });
  });

  it("stores a blank title as the body alone", () => {
    const documents = entryDocuments({ ...note, title: "   " });

    expect(documents.markdown.text).toBe("Revised.");
    expect(Object.keys(JSON.parse(documents.sidecar.text).metadataAttributes)).toEqual([
      "entryId",
      "date",
      "tags",
    ]);
  });

  it("keeps the same keys when the note is edited", () => {
    const saved = entryDocuments(note);
    const edited = entryDocuments({ ...note, title: "After", body: "Changed." });

    expect(edited.markdown.key).toBe(saved.markdown.key);
    expect(edited.sidecar.key).toBe(saved.sidecar.key);
    expect(edited.markdown.text).toBe("# After\n\nChanged.");
  });

  it("names both objects when the note is deleted", () => {
    const documents = entryDocuments(note);

    expect(deletedEntryKeys(note.id)).toEqual([documents.markdown.key, documents.sidecar.key]);
  });
});
