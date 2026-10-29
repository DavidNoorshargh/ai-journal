# Coding conventions

Product behaviour is in [docs/plan.md](docs/plan.md). Expo commands and native rules are in [app/AGENTS.md](app/AGENTS.md). This file is how to shape the code.

## Stepdown rule - Code should read like well written prose

Read a file from top to bottom, one level of detail at a time. The function a caller came for is first. Its body is the steps, in order. Each step is a function defined further down, in the same order. A reader should not jump back up the file to learn what happens next.

```ts
export async function createEntry(sql: Sql, input: NewEntry): Promise<Entry> {
  const entry = entryFrom(input);
  await transaction(sql, async () => {
    await insertEntry(sql, entry);
    await insertTags(sql, entry.id, entry.tags);
  });
  return entry;
}
```

`entryFrom`, `insertEntry`, and `insertTags` are defined below `createEntry`, in that order. The same rule applies in Python.

## Names

A function's name says what it does or what it returns. `requireDate`, `cleanTitle`, and `entryLabel` are names. `handle`, `process`, `doStuff`, and `data` are not. A name that needs "and" is two functions.

## One job, and short

A function does one thing. The body is a short sequence of named steps. When a block needs a comment to say what it is for, that block is its own function. Split a function that no longer fits on one screen.
