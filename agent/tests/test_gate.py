from types import SimpleNamespace

from evals.gate_summary import batch_unusable, evaluation_score, pass_rates, rate_for_evaluator


def test_batch_unusable_when_status_failed():
    result = SimpleNamespace(
        status="FAILED",
        agent_invocation_failures=[],
        evaluation_results=SimpleNamespace(number_of_sessions_completed=6),
    )
    assert batch_unusable(result) is True


def test_batch_unusable_when_no_sessions_completed():
    result = SimpleNamespace(
        status="COMPLETED",
        agent_invocation_failures=[],
        evaluation_results=SimpleNamespace(number_of_sessions_completed=0),
    )
    assert batch_unusable(result) is True


def test_batch_usable_when_sessions_completed():
    result = SimpleNamespace(
        status="COMPLETED",
        agent_invocation_failures=[],
        evaluation_results=SimpleNamespace(number_of_sessions_completed=6),
    )
    assert batch_unusable(result) is False


def test_pass_rates_from_numeric_and_labels():
    events = [
        {"attributes": {"gen_ai.evaluation.name": "ids", "gen_ai.evaluation.score.value": 1.0}},
        {"attributes": {"gen_ai.evaluation.name": "ids", "gen_ai.evaluation.score.label": "FAIL"}},
        {"attributes": {"gen_ai.evaluation.name": "Builtin.Faithfulness", "gen_ai.evaluation.score.value": 1.0}},
    ]
    rates = pass_rates(events)
    assert rates["ids"] == 0.5
    assert rates["Builtin.Faithfulness"] == 1.0


def test_evaluation_score_ignores_explanation_only_events():
    assert evaluation_score({"attributes": {"gen_ai.evaluation.explanation": "secret"}}) == (None, None)


def test_rate_for_evaluator_matches_prefix():
    rates = {"ai_journal_entry_ids": 1.0}
    assert rate_for_evaluator("ai_journal_entry_ids-fPWIu46JU3", rates) == 1.0
