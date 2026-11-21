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

from evals.gate_summary import average_score, batch_unusable, pass_rates, rate_for_evaluator


def main():
    region = require_env("AWS_REGION")
    runtime_arn = require_env("AGENT_RUNTIME_ARN")
    service_name = require_env("AGENT_DEFAULT_SERVICE_NAME")
    log_group = require_env("AGENT_DEFAULT_LOG_GROUP")
    entry_ids_evaluator = require_env("ENTRY_IDS_EVALUATOR_ID")
    golden_path = require_env("GOLDEN_DATASET_PATH")
    kms_key_arn = os.environ.get("LOGS_KEY_ARN") or None

    dataset = FileDatasetProvider(golden_path).get_dataset()
    client = boto3.client("bedrock-agentcore", region_name=region)
    runner = BatchEvaluationRunner(region=region)
    config = gate_config(service_name, log_group, entry_ids_evaluator, kms_key_arn)
    result = runner.run_dataset_evaluation(
        agent_invoker=lambda invoker_input: invoke_default(client, runtime_arn, invoker_input),
        dataset=dataset,
        config=config,
    )
    print_summary(result, runner)
    return 1 if batch_unusable(result) else 0


def gate_config(service_name, log_group, entry_ids_evaluator, kms_key_arn):
    config = BatchEvaluationRunConfig(
        batch_evaluation_name=f"ai_journal_gate_{uuid.uuid4().hex[:8]}",
        evaluator_config=BatchEvaluatorConfig(
            evaluator_ids=["Builtin.Faithfulness", entry_ids_evaluator],
        ),
        data_source=CloudWatchDataSourceConfig(
            service_names=[service_name],
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


def print_summary(result, runner=None):
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
    rates = pass_rates_from_runner(runner, result)
    for item in summary.evaluator_summaries or []:
        average = average_score(item)
        if average is None:
            average = rate_for_evaluator(item.evaluator_id, rates)
        print(
            f"evaluator={item.evaluator_id} average={average} "
            f"evaluated={item.total_evaluated} failed={item.total_failed}"
        )


def pass_rates_from_runner(runner, result):
    if runner is None:
        return {}
    try:
        events = runner.fetch_evaluation_events(result)
    except (ValueError, LookupError):
        return {}
    return pass_rates(events)


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


if __name__ == "__main__":
    sys.exit(main())
