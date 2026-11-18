import json

from evals.id_evaluator import handler


def test_pass_when_tool_result_matches_expected_ids():
    event = {
        "evaluationReferenceInputs": [{"assertions": [{"text": "entry_ids=fixture-retrieval"}]}],
        "evaluationInput": {
            "sessionSpans": [
                {
                    "name": "execute_tool search_entries",
                    "attributes": {
                        "gen_ai.tool.name": "search_entries",
                        "gen_ai.tool.call.result": json.dumps(
                            [{"entryId": "fixture-retrieval", "date": "20261024", "text": "lantern"}]
                        ),
                    },
                }
            ]
        },
    }

    result = handler(event, None)

    assert result == {
        "label": "PASS",
        "value": 1.0,
        "explanation": "expected=[fixture-retrieval] returned=[fixture-retrieval]",
    }


def test_fail_when_ids_differ():
    event = {
        "evaluationReferenceInputs": [{"assertions": ["entry_ids=fixture-retrieval"]}],
        "evaluationInput": {
            "sessionSpans": [
                {
                    "attributes": {
                        "gen_ai.tool.name": "search_entries",
                        "gen_ai.tool.call.result": json.dumps(
                            [{"entryId": "fixture-amber-compass", "text": "compass"}]
                        ),
                    }
                }
            ]
        },
    }

    result = handler(event, None)

    assert result["label"] == "FAIL"
    assert result["value"] == 0.0
    assert "fixture-retrieval" in result["explanation"]
    assert "fixture-amber-compass" in result["explanation"]


def test_empty_expectation_passes_when_search_returns_nothing():
    event = {
        "evaluationReferenceInputs": [{"text": "entry_ids="}],
        "evaluationInput": {
            "sessionSpans": [
                {
                    "attributes": {
                        "gen_ai.tool.name": "search_entries",
                        "gen_ai.tool.call.result": "[]",
                    }
                }
            ]
        },
    }

    assert handler(event, None)["label"] == "PASS"


def test_missing_ground_truth_is_an_error():
    result = handler({"evaluationReferenceInputs": [], "evaluationInput": {"sessionSpans": []}}, None)

    assert result["errorCode"] == "MISSING_GROUND_TRUTH"
