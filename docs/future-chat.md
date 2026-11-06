# Future: a conversation over the journal

This is not a v1 step. The locked Ask screen stays one question, one summary, and short links. This note is the later chat, so the idea is not lost.

## What it is

A continuous conversation that sits over the journal. Each message can search the notes, and it can also refer to what was just said. "What were my thoughts about this?" searches. "What do you think about these thoughts?" continues from the previous reply and the notes that reply used.

It is an expert on the journal entries only. A question the journal does not cover is still "The journal does not contain it." A follow-up may press on the notes already in the conversation. It does not use the open web, and it does not invent a view of the writer that no entry states. Conclusions still quote what the entries say.

## What stays put

The journal stays on the phone and in the index. The conversation is a separate thread. AgentCore Memory is not the journal. Long-term memory stays off, because it would extract a profile from the turns.

## How a turn works

The phone keeps the transcript. Each Send includes the new message and the recent turns, not the whole history, so a long chat stays small. One conversation reuses one thread.

The agent reads that thread. It searches the journal when the message needs a note. It answers from the previous turn when the message is about what was just said. A turn that does not search is still a reply. It is not wiped to "The journal does not contain it."

Each reply can still end with the same short links: the date and the title, or the first line of the body when the title is blank. The note opens only when the user taps a link.

## Where the transcript lives

On the phone, in the same local database as the notes. That is enough for one person continuing the chat on this phone. The screen is a scrolling transcript, not the single-summary Ask screen.

AgentCore short-term memory is optional and later. It is a copy of the same turns in AWS, under the user and a conversation id, so the thread can reload after a restart or continue from a second device. It is conversation state only.

## Left out

A second device, sharing the chat, a general assistant, and long-term memory. The score cutoff and the reranker from the v1 plan still apply to any search this chat runs.
