# Bring the running stack in line with Bedrock practice

This is not a v1 step. The journal, the customer-managed Knowledge Base, and the one-search agent stay. This note is the later hardening, so the review is not lost.

The live Bedrock guidance was read before this list. Where that guidance prefers a Managed Knowledge Base or the AgentCore Harness, this journal keeps the choices already locked in [.cursor/skills/amazon-bedrock/SKILL.md](../.cursor/skills/amazon-bedrock/SKILL.md).

## What stays put

- Region `eu-west-2`. The chat model stays `amazon.nova-lite-v1:0`. Embeddings stay on Titan Text Embeddings V2.
- The Knowledge Base stays the existing customer-managed one, with S3 Vectors. A Managed Knowledge Base would drop the vector bucket and the ingestion queue. That migration is not part of this work.
- The agent stays the Python zip on AgentCore Runtime. One turn stays one `search_entries` call, then a forced summary. Python still checks the date window, the score cutoff, and the citation ids.
- Bedrock invocation logging stays off. Journal text is not printed while the sidecars are rewritten.
- The main stack is applied by the GitHub Actions pipeline, not from the laptop.
- The runtime stays on the public network. A VPC, a NAT gateway, and private endpoints would be a second network for one signed-in user. The identity-pool role is the gate.

## 1. Cap both model calls

Set `maxTokens` on the search call and on the summary call. The cap is high enough for one short paragraph and no higher. An unset cap reserves the model's full output allowance and is a common cause of throttling.

This changes the agent only. The next pipeline apply publishes the zip. The index does not change.

## 2. Lock the runtime the way the Knowledge Base role is already locked

Declare IAM as the runtime authorizer, so the identity-pool role remains the only caller. Add the account and runtime conditions to the agent role trust. The Knowledge Base role already has the matching conditions.

Create the AgentCore log group in Terraform, with a retention limit and a key. The runtime currently creates that group itself, with no retention. Request and reply payloads can land there even while Bedrock invocation logging is off. Retention bounds how long they stay. The key is the encryption the runtime guidance asks for.

This is an infra change. The pipeline applies it.

## 3. Filter the date in the index, before ranking

`date` is stored as the text `YYYYMMDD`. A range filter on that text is rejected, so a time question retrieves the nearest notes and only then keeps the ones in the window. A note from the right day can be missing once the index is larger than the result cap.

Write `date` in the sidecar as the number `YYYYMMDD`. A number can take a range. Send that range with the retrieve call, together with the tag filter when the question has tags. Python still drops anything outside the window.

Turn the numeric filter on only after every existing sidecar has been rewritten and ingestion has finished. Until then the filter would hide every note whose date is still text. Rewriting a sidecar changes the metadata object, so the following ingestion job has to pick those objects up. The note body is not rewritten and is not printed.

New saves write the numeric date from then on. Restore accepts a numeric date and the older text date, so a sidecar that has not been rewritten yet still loads.

## Order

Do 1, then 2, then 3. Step 1 is the agent zip. Step 2 is the runtime and its log group. Step 3 waits until the rewritten sidecars are in the index, and only then does search send the range.
