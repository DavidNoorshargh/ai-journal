"""Record-only Faithfulness gate: ask DEFAULT, score, print averages."""

import json
import os
import sys
import uuid

import boto3
from bedrock_agentcore.evaluation import (
    AgentInvokerOutput,
    BatchEvaluationRunConfig,
    BatchEvaluationRunner,
    BatchEvaluatorConfig,
    CloudWatchDataSourceConfig,
    FileDatasetProvider,
)


def main():
    region = require_env("AWS_REGION")
    runtime_arn = require_env("AGENT_RUNTIME_ARN")
    runtime_id = require_env("AGENT_RUNTIME_ID")
    log_group = require_env("AGENT_DEFAULT_LOG_GROUP")
    entry_ids_evaluator = require_env("ENTRY_IDS_EVALUATOR_ID")
    golden_path = require_env("GOLDEN_DATASET_PATH")
    kms_key_arn = os.environ.get("LOGS_KEY_ARN") or None

    dataset = FileDatasetProvider(golden_path).get_dataset()
    client = boto3.client("bedrock-agentcore", region_name=region)
    config = gate_config(runtime_id, log_group, entry_ids_evaluator, kms_key_arn)
    result = BatchEvaluationRunner(region=region).run_dataset_evaluation(
        agent_invoker=lambda invoker_input: invoke_default(client, runtime_arn, invoker_input),
        dataset=dataset,
        config=config,
    )
    print_summary(result)
    return 0


def gate_config(runtime_id, log_group, entry_ids_evaluator, kms_key_arn):
    config = BatchEvaluationRunConfig(
        batch_evaluation_name=f"ai_journal_gate_{uuid.uuid4().hex[:8]}",
        evaluator_config=BatchEvaluatorConfig(
            evaluator_ids=["Builtin.Faithfulness", entry_ids_evaluator],
        ),
        data_source=CloudWatchDataSourceConfig(
            service_names=[f"{runtime_id}.DEFAULT"],
            log_group_names=[log_group],
            ingestion_delay_seconds=int(os.environ.get("INGESTION_DELAY_SECONDS", "180")),
        ),
        polling_timeout_seconds=int(os.environ.get("POLLING_TIMEOUT_SECONDS", "1800")),
        polling_interval_seconds=30,
        kms_key_arn=kms_key_arn,
    )
    return config


def invoke_default(client, runtime_arn, invoker_input):
    session_id = invoker_input.session_id
    if len(session_id) < 33:
        session_id = f"gate{uuid.uuid4().hex}"
    response = client.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        qualifier="DEFAULT",
        runtimeSessionId=session_id,
        payload=request_payload(invoker_input.payload),
    )
    return AgentInvokerOutput(agent_output=json.loads(response["response"].read()))


def request_payload(turn_input):
    if isinstance(turn_input, dict):
        body = dict(turn_input)
    elif isinstance(turn_input, str):
        body = {"question": turn_input, "unsyncedEntries": [], "includeFixtures": True}
    else:
        raise TypeError("turn input must be a string or object")
    body.setdefault("unsyncedEntries", [])
    body["includeFixtures"] = True
    return json.dumps(body).encode()


def print_summary(result):
    print(f"status={result.status}")
    print(f"batch_evaluation_id={result.batch_evaluation_id}")
    failures = result.agent_invocation_failures or []
    print(f"invocation_failures={len(failures)}")
    summary = result.evaluation_results
    if summary is None:
        print("sessions_scored=0")
        return
    print(f"sessions_completed={summary.number_of_sessions_completed}")
    print(f"sessions_failed={summary.number_of_sessions_failed}")
    print(f"sessions_total={summary.total_number_of_sessions}")
    for item in summary.evaluator_summaries or []:
        average = None
        if item.statistics is not None:
            average = item.statistics.average_score
        print(
            f"evaluator={item.evaluator_id} average={average} evaluated={item.total_evaluated}"
        )


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


if __name__ == "__main__":
    sys.exit(main())
