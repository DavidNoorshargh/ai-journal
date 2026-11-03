export type CloudObject = {
  key: string;
  text: string;
};

export type EntryDocuments = {
  markdown: CloudObject;
  sidecar: CloudObject;
};

type NoteText = {
  id: string;
  date: string;
  title: string;
  body: string;
  tags: readonly string[];
};

export function entryDocuments(note: NoteText): EntryDocuments {
  return {
    markdown: markdownDocument(note),
    sidecar: sidecarDocument(note),
  };
}

export function deletedEntryKeys(id: string): string[] {
  return [markdownKey(id), sidecarKey(id)];
}

function markdownDocument(note: NoteText): CloudObject {
  return {
    key: markdownKey(note.id),
    text: markdownText(note),
  };
}

function sidecarDocument(note: NoteText): CloudObject {
  return {
    key: sidecarKey(note.id),
    text: sidecarText(note),
  };
}

function markdownKey(id: string): string {
  return `entries/${id}.md`;
}

function sidecarKey(id: string): string {
  return `${markdownKey(id)}.metadata.json`;
}

function markdownText(note: NoteText): string {
  const title = note.title.trim();
  if (title === "") {
    return note.body;
  }
  return `# ${title}\n\n${note.body}`;
}

function sidecarText(note: NoteText): string {
  return JSON.stringify({
    metadataAttributes: {
      entryId: note.id,
      date: note.date,
      tags: [...note.tags],
    },
  });
}
