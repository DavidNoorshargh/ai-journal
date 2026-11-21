"""Pure helpers for Faithfulness gate summaries (no AWS SDK imports)."""


def batch_unusable(result):
    """True when the batch produced nothing useful to record."""
    if result.status == "FAILED":
        return True
    if result.agent_invocation_failures:
        return True
    summary = result.evaluation_results
    if summary is None:
        return True
    return (summary.number_of_sessions_completed or 0) == 0


def average_score(item):
    if item.statistics is None:
        return None
    return item.statistics.average_score


def pass_rates(events):
    """Mean of numeric scores (or PASS=1) per evaluator name. No explanations."""
    totals = {}
    scores = {}
    for event in events:
        name, score = evaluation_score(event)
        if name is None or score is None:
            continue
        totals[name] = totals.get(name, 0) + 1
        scores[name] = scores.get(name, 0.0) + score
    return {name: scores[name] / count for name, count in totals.items() if count}


def evaluation_score(event):
    attrs = event.get("attributes") or {}
    name = attrs.get("gen_ai.evaluation.name")
    if not name:
        return None, None
    value = attrs.get("gen_ai.evaluation.score.value")
    if isinstance(value, (int, float)):
        return name, float(value)
    label = (attrs.get("gen_ai.evaluation.score.label") or "").upper()
    if label == "PASS":
        return name, 1.0
    if label == "FAIL":
        return name, 0.0
    return name, None


def rate_for_evaluator(evaluator_id, rates):
    if not evaluator_id:
        return None
    if evaluator_id in rates:
        return rates[evaluator_id]
    for name, rate in rates.items():
        if evaluator_id.startswith(name) or name.startswith(evaluator_id):
            return rate
    return None
