import json
from datetime import datetime, timezone

import pytest

from evals.faithfulness import (
    ADDED_SENTENCE,
    JUDGE_MODEL,
    SOURCE_NAME,
    _boto,
    dataset,
    faithfulness_scores,
    job_name,
    job_request,
    paragraph,
    scores_from_body,
)


def test_dataset_has_a_faithful_line_and_one_added_sentence():
    rows = [json.loads(line) for line in dataset("River walk.").splitlines()]
    first = rows[0]["conversationTurns"][0]
    second = rows[1]["conversationTurns"][0]

    assert first["output"]["text"] == "River walk."
    assert second["output"]["text"] == f"River walk. {ADDED_SENTENCE}"
    assert first["referenceResponses"][0]["content"][0]["text"] == "River walk."
    assert second["referenceResponses"][0]["content"][0]["text"] == "River walk."
    assert first["output"]["retrievedPassages"]["retrievalResults"][0]["content"]["text"] == "River walk."
    assert second["output"]["retrievedPassages"]["retrievalResults"][0]["content"]["text"] == "River walk."


def test_dataset_names_the_same_source_as_the_job():
    row = json.loads(dataset("River walk.").splitlines()[0])
    request = job_request(
        "arn:aws:iam::111122223333:role/ai-journal-faithfulness",
        "s3://bucket/eval/faithfulness/input/job.jsonl",
        "s3://bucket/eval/faithfulness/output/job/",
        "ai-journal-faithfulness-20261113161800",
    )
    source = request["inferenceConfig"]["ragConfigs"][0]["precomputedRagSourceConfig"]
    metric = request["evaluationConfig"]["automated"]["datasetMetricConfigs"][0]

    assert row["conversationTurns"][0]["output"]["knowledgeBaseIdentifier"] == SOURCE_NAME
    assert source["retrieveAndGenerateSourceConfig"]["ragSourceIdentifier"] == SOURCE_NAME
    assert metric["metricNames"] == ["Builtin.Faithfulness"]
    judge = request["evaluationConfig"]["automated"]["evaluatorModelConfig"]["bedrockEvaluatorModels"]
    assert judge == [{"modelIdentifier": JUDGE_MODEL}]


def test_job_request_uses_boto_names():
    request = job_request("role", "s3://in", "s3://out/", "ai-journal-faithfulness-20261113161800")
    sent = _boto(request)
    assert sent["job_name"] == "ai-journal-faithfulness-20261113161800"
    assert sent["application_type"] == "RagEvaluation"
    metric = sent["evaluation_config"]["automated"]["dataset_metric_configs"][0]
    assert metric["dataset"]["dataset_location"]["s3_uri"] == "s3://in"
    source = sent["inference_config"]["rag_configs"][0]["precomputed_rag_source_config"]
    assert source["retrieve_and_generate_source_config"]["rag_source_identifier"] == SOURCE_NAME


def test_job_name_is_lowercase():
    name = job_name(datetime(2026, 11, 13, 16, 18, tzinfo=timezone.utc))
    assert name == "ai-journal-faithfulness-20261113161800"


def test_scores_keep_the_number_and_the_reason():
    body = json.dumps({
        "conversationTurns": [{"output": {"text": "River walk."}}],
        "automatedEvaluationResult": {
            "scores": [{
                "metricName": "Builtin.Faithfulness",
                "result": 1,
                "evaluatorDetails": [{"explanation": "The paragraph matches the passage."}],
            }]
        },
    })

    assert scores_from_body(body) == [{
        "score": 1,
        "explanation": "The paragraph matches the passage.",
    }]
    assert faithfulness_scores(json.loads(body))[0].keys() == {"score", "explanation"}


def test_a_broken_result_line_is_skipped():
    body = "not json\n" + json.dumps({
        "automatedEvaluationResult": {
            "scores": [{"metricName": "Builtin.Faithfulness", "result": 0.2, "evaluatorDetails": []}]
        }
    })
    assert scores_from_body(body) == [{"score": 0.2, "explanation": ""}]


def test_blank_passage_is_refused():
    with pytest.raises(ValueError):
        paragraph("   ")
