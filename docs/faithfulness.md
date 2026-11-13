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

The service role is `ai-journal-faithfulness`. It can read `eval/faithfulness/input/`, write `eval/faithfulness/output/`, and invoke Nova Pro. It cannot read the journal bucket. Bedrock can assume it only for an evaluation job in this account. The GitHub deploy role is not the job role. The deploy role can create this role after `infra/bootstrap` is applied. The job itself is not a Terraform resource and does not run on a push to `main`.

Results go to their own prefix in the artifacts bucket. Each row comes back with a score from 0 to 1 and a short explanation. The first row should score high. The second row should score lower, and the explanation should name the added sentence.

No threshold is chosen. The job does not fail a pull request, and it does not run on a push to `main`.

## Order

1. Apply `infra/bootstrap` so the deploy role may create `ai-journal-faithfulness`.
2. Let the pipeline apply the main stack, which creates that role.
3. Confirm Nova Pro is enabled for `eu-west-2`.
4. From `agent/`, with the SSO profile, run `python evals/faithfulness.py submit`. It reads `entries/fixture-retrieval.md`, writes the two-line file under `eval/faithfulness/input/`, creates the job, and prints the two scores and explanations. It does not print the fixture.
5. Read those two lines. The first should score high. The second should score lower, and the explanation should name the added sentence.

`python evals/faithfulness.py scores <job-arn>` prints the scores again without creating another job. An explanation can quote the fixture, so keep that output private.

Stop there. Citation precision, citation coverage, and correctness stay in step 7.3.
