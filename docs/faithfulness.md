# Learn Faithfulness with one Bedrock judge

This is a familiarity pass. It is not step 7.3. Step 7.3 still waits until a month of cost is visible, and it still scores citation precision, citation coverage, and correctness as well. This pass runs one metric, once, so the score and the written reason are visible.

The job is an Amazon Bedrock RAG evaluation, type retrieve and generate, with bring-your-own inference responses. Bedrock does not call the Knowledge Base and does not write a new answer. The dataset already holds the question, the passages the agent retrieved, and the paragraph the agent wrote. The judge only scores that paragraph.

AgentCore's online evaluators are a different product. They sample live traces. This pass does not turn those on.

## What the judge receives

One JSON Lines file in S3. Each line is one conversation turn:

- `prompt` is the question.
- `output.text` is the paragraph the agent wrote.
- `output.retrievedPassages` is the passage text the search returned.
- `output.knowledgeBaseIdentifier` is a name for this agent. The same name is the source name on the job.
- `output.modelIdentifier` is `amazon.nova-lite-v1:0`.
- `referenceResponses` is included because the retrieve-and-generate dataset lists it. Faithfulness does not score against it. Faithfulness scores the paragraph against the retrieved passages.

The file stays out of git. It contains note text. Two lines are enough:

1. A paragraph that only says what the retrieval fixture says.
2. The same passages, with one sentence added that the fixture does not say.

The personal notes stay out of this first job.

## The job

Region `eu-west-2`. One job, one metric: `Builtin.Faithfulness`.

The evaluator model is Amazon Nova Pro, through the EU cross-region inference profile. It is on the supported evaluator list, and it is a stronger model than the Nova Lite writer. Confirm that profile is enabled in this account before creating the job. The console's model picker is the check.

The service role can read the dataset prefix, write the results prefix, and invoke that evaluator model. Bedrock may create this role. It is not the GitHub deploy role, and the main stack is not applied for this pass.

Results go to their own prefix in the artifacts bucket. Each row comes back with a score from 0 to 1 and a short explanation. The first row should score high. The second row should score lower, and the explanation should name the added sentence.

No threshold is chosen. The job does not fail a pull request, and it does not run on a push to `main`.

## Order

1. Confirm Nova Pro is enabled for `eu-west-2`.
2. Build the two-line dataset from the fixture and upload it to S3.
3. Create the one-metric job and wait until it finishes.
4. Read the two scores and the two explanations.

Stop there. Citation precision, citation coverage, and correctness stay in step 7.3.
