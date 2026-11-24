# Gate and monitor answers with AgentCore Faithfulness

AgentCore Evaluations scores the journal's answers with its built-in judge, `Builtin.Faithfulness`. It runs in two places, which is the AWS pattern: as a gate in the pipeline before a new agent reaches the phone, and as monitoring on the answers the phone actually gets. The gate adds a second, exact check: a small evaluator of our own that compares the returned entry ids with the expected ones.

Step 7.3 in [plan.md](plan.md) points here. The README links here for the short accuracy story.

## How accuracy is ensured

Accuracy is three layers that catch different failures.

**Retrieval.** Phone asks search only real notes (`fixture != true`). The gate searches only fixtures (`fixture == true`), so golden questions do not compete with the live journal. On a subject search, Python then applies two score rules: if the best hit is below 0.6, return nothing; otherwise keep only notes within nine tenths of that best. A time-only window skips those cutoffs, because the answer is the notes in range. The model summarises only what search returned, and the phone builds links only from those ids.

**Gate.** After apply, the batch runner asks the golden fixture questions of `DEFAULT`. `Builtin.Faithfulness` fails an answer that conflicts with the question, the search, or the returned notes. The id evaluator fails when the wrong notes came back, which Faithfulness often misses when search is empty. Today the job records those scores; once a threshold is set, it moves `production` only when both pass.

**Monitoring.** Every `production` answer is scored again with Faithfulness. An alarm emails when the score drops. Live retrieval has no expected ids, so the id check does not run online; the gate covers that for the fixture set.

## What the judge checks

The judge is a model AWS picks and runs inside the service, with a prompt AWS publishes and does not let you edit. It reads one turn: the question, the `search_entries` call, the notes it returned, and the answer. It asks one thing: does the answer conflict with any of that?

It picks one label: Completely Yes, Generally Yes, Neutral/Mixed, Not Generally, or Not At All. It adds up to 250 words of reasoning, which can quote a note. It is told to pick Completely Yes unless it finds a conflict.

So it catches an answer that says the opposite of a note or gets a date wrong. It does not catch a claim the notes never made, such as a mood no entry states, because that conflicts with nothing. Checking that every claim is backed by a note needs a custom judge with your own rubric. That is a later option, not part of this plan.

## Two endpoints

The `DEFAULT` endpoint moves to the newest version on every apply. Terraform owns a `production` endpoint with `ignore_changes` on its version, so only the gate moves it. The phone calls `qualifier=production`, and the identity-pool role may invoke only that endpoint. `DEFAULT` is staging. Rollback is pointing `production` back at the previous version.

## The golden dataset

The gate's questions live in an AgentCore dataset, which is how the AWS tools keep a regression set. A dataset has one editable draft and immutable numbered versions, so a gate run is pinned to the exact scenarios it used.

The scenarios are written in [agent/evals/golden.json](../agent/evals/golden.json), in the AgentCore dataset schema. Each one is a question about a fixture note, plus its ground truth: an assertion listing the entry ids it should return. A change to that file is published as a new dataset version, and the gate runs the newest one.

## The id evaluator

No built-in evaluator compares returned entry ids, so the gate uses a code-based evaluator, the AWS form for an exact check. It is a small Lambda, registered with `create-evaluator` at trace level. AgentCore sends it the turn's spans and the scenario's ground truth. It reads the ids from the `search_entries` result and the answer, compares them with the expected ids, and returns PASS or FAIL with a score of 1 or 0. Its explanation names only entry ids.

The result lands next to the Faithfulness score, in the same results log group and metric namespace. Pytest covers the Lambda with made-up spans.

## The gate

A `faithfulness` job runs on `main` after apply, in the `production` environment. It uses the batch runner from the AgentCore Python SDK, which asks each dataset question, waits for the spans, and starts one batch evaluation over those sessions:

1. Load the newest version of the golden dataset.
2. Run it with the batch runner against `DEFAULT`. A small function sends each question to that endpoint with a fresh session id. The evaluators are `Builtin.Faithfulness` and the id evaluator.
3. Read the result: an average score per evaluator, and how many sessions were scored.
4. If the id evaluator averages 1, every session passed and the Faithfulness average meets the threshold, move `production` to the version apply just created. Otherwise `production` stays where it was and the job fails.

The repository and its Actions logs are public. The job prints evaluator averages and session counts, never an answer or an explanation. The per-session detail stays in CloudWatch.

The first runs only record the averages and do not move or hold `production`. AWS's guidance is to measure a baseline first. The threshold is picked after a few runs, and only then does the gate block.

## What the gate can and cannot stop

A runtime version is the zip and the runtime's settings, such as the model id. The gate holds a bad version back from the phone, so a change to the prompt, the search code, the answer cleanup, or the model id is blocked.

Both endpoints share everything else: the Knowledge Base, the vector index, ingestion, the IAM roles, and the model behind the id. A change there reaches the phone in the same apply, before the gate runs. The gate still catches it minutes later, and the job fails, but it cannot hold it back. Moving `production` to an older version does not undo it. Reverting the Terraform change does.

Faithfulness alone often misses broken retrieval. An agent that gets no notes says the journal does not contain the answer, and that conflicts with nothing. The id evaluator is what fails when search breaks.

A regression with no deploy, such as a model change on AWS's side or an index that has grown, is caught by the online scores and the alarm, not the gate.

Blocking shared-infrastructure regressions too needs AWS's full pattern: a separate pre-production copy of the stack, ideally in its own account, applied and gated before production. That doubles the stack for one user and is not adopted. The gate job, the dataset, and the evaluators would carry over unchanged, pointed at that copy's runtime instead of `DEFAULT`.

## Fixture notes

The golden questions are about made-up notes, so committing them reveals nothing about the journal. Three to five fixture notes go into `entries/` with known ids, dates years in the past, subjects the real journal does not have, and sidecar metadata `fixture: true`.

Phone asks and empty-journal restore skip those notes. The gate opts back in with `includeFixtures: true` on the invoke payload so golden questions can still find them. Search enforces that split in the Knowledge Base filter: phone uses `fixture != true`, gate uses `fixture == true`. Ids also start with `fixture-` as a second check.

## Monitoring

An online evaluation config scores every answer the `production` endpoint gives with `Builtin.Faithfulness`. The session idle timeout is 5 minutes, because each question already uses its own session id. Scores arrive in CloudWatch a few minutes after that.

Sampling is 100%. That is a deliberate departure from the AWS starting point of 5–10%, which keeps judge cost down on busy agents. One person asks a few questions a day, so scoring every answer costs little and a sample would leave most days unscored.

The id evaluator does not run online, because a live question has no expected ids. No built-in evaluator judges whether the returned notes fit the question, so live retrieval quality is not monitored. The gate's id check covers retrieval only for the fixture questions. A custom judge could cover live retrieval later.

A CloudWatch alarm on the `Bedrock-AgentCore/Evaluations` metric emails you when the Faithfulness score drops below the gate's threshold. The alarm's email topic is encrypted with the stack's KMS key, as the AWS guidance asks. The email address lives in `terraform.tfvars`, not in git.

## The decision this changes

[plan.md](plan.md) said prompts are not copied into CloudWatch. The judge reads the question, the returned notes, and the answer from the trace, so that text has to be in CloudWatch. It stays bounded:

- Spans go to each endpoint's own runtime log group, not the shared `aws/spans` group. The runtime sets `UNIFIED_TRACES_DESTINATION_ENABLED=true`.
- Terraform owns the `DEFAULT` and `production` log groups, with a 14-day retention and a customer-managed KMS key. The `DEFAULT` group exists today with no retention, so Terraform imports it.
- The evaluation results group is created by the service on the first score. Explanations can quote a note. Once its name is known, Terraform owns it with the same retention.
- Bedrock invocation logging stays off.

## Spans the judge can read

The zip adds `aws-opentelemetry-distro`, and the entry point becomes `["opentelemetry-instrument", "main.py"]`. That is the AWS form for a Python zip on AgentCore Runtime. The runtime supplies the exporter settings and stamps each span with the session id.

ADOT records the boto3 calls on its own, but Evaluations skips AWS SDK spans. So the agent writes three kinds of span itself, in the OpenTelemetry generative AI conventions. The tracer name starts with `opentelemetry.instrumentation.`, which AWS documents as the opt-in for custom instrumentation.

- One `invoke_agent` span per question. `gen_ai.task.input` is the question followed by the unsynced notes, so the judge can see every note the answer could use. `gen_ai.task.output` is the answer the phone receives, after the copied-sentence and id cleanup.
- One `execute_tool` span for `search_entries`. Its arguments are the query, tags, and dates. Its result is the same entry list the model receives.
- One `chat` span for each of the two Converse calls, with the messages sent and the reply.

This lives in one small module. `main.py` and `model.py` call it. Pytest checks the span names and attributes with an in-memory exporter and made-up text.

AWS's first-listed path is Strands, whose spans Evaluations reads with no extra code. The journal's locked choices rule out Strands unless you ask, and it would replace the agent loop.

## Account setup

Transaction Search is off. The trace destination is X-Ray today. The main stack turns it on with `aws_cloudwatch_log_resource_policy`, which lets X-Ray write spans and carries account and source conditions, and with `aws_xray_trace_segment_destination` set to `CloudWatchLogs`.

The account has no CloudTrail trail. The default 90-day event history records control-plane changes, but the AWS guidance asks for a trail of who changes AgentCore resources, evaluations included. The main stack adds one trail for management events, with log file validation, into its own private S3 bucket.

## Roles

- **Agent role.** Adds the tracing permissions AWS lists for a runtime: X-Ray trace segments and sampling rules, `cloudwatch:PutMetricData` limited to the `bedrock-agentcore` namespace, and describe on log groups and streams.
- **Evaluation role, `ai-journal-evaluation`.** Only `bedrock-agentcore.amazonaws.com` can assume it, and only for an evaluation resource in this account and region. It can query the two runtime log groups, write `/aws/bedrock-agentcore/evaluations/*`, and invoke the id evaluator Lambda. It has no Bedrock model permission, because built-in judges run inside the service.
- **Id evaluator role.** The Lambda writes its own logs and nothing else.
- **Identity-pool role.** Invokes the `production` endpoint only.
- **Deploy role.** Bootstrap lets it manage the `production` endpoint, the evaluation and id evaluator roles, the id evaluator Lambda and its registration, the golden dataset, online evaluation configs, the runtime log groups, the log key, the X-Ray destination, the log resource policy, the trail and its bucket, the alarm, and its email topic. For the gate it may read the dataset, invoke `DEFAULT`, start and read batch evaluations, move the `production` endpoint, and pass the evaluation role only to AgentCore.

## Cost

Built-in judges are billed by the tokens they read, and journal answers are short. The gate adds one judged answer per golden question per deploy that touches the agent or infra, and a few minutes to that run. The id evaluator is one short Lambda call per question. The KMS key is about $1 a month. Spans are billed as CloudWatch Logs ingestion and storage, and the 14-day retention bounds the storage. The first trail of management events is free apart from its S3 storage.

## Order

1. Push the undo commit and approve the apply, which deletes the old `ai-journal-faithfulness` role. Only then apply `infra/bootstrap` from the laptop for the new deploy role permissions.
2. Push the agent spans, ADOT, the agent role permissions, the owned `DEFAULT` log group, Transaction Search, and the trail. Approve the apply.
3. Ask two questions on the phone. Count the spans in the runtime log group by name and scope, without printing their text. Expect `invoke_agent`, `execute_tool`, and `chat`.
4. Push the `production` endpoint at the current version, its log group, and invoke on both endpoints for the identity-pool role. Approve the apply. Rebuild the app with `qualifier=production` and install it. Then push the identity-pool role down to `production` only.
5. Upload the fixture notes and wait for ingestion. Push the golden dataset file, the id evaluator, the evaluation role, and the gate job in record-only mode. Run it on a few deploys.
6. Push the online evaluation config on `production`, the alarm, and its encrypted topic. Approve the apply. Ask a question and read the score in CloudWatch. The explanation can quote a note, so it stays in the account and out of git.
7. Pick the threshold from the recorded runs. Set it on the gate and the alarm, and switch the gate to blocking.
