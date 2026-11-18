"""Code-based AgentCore evaluator: expected entry ids vs search_entries."""

import json
import re

ENTRY_IDS_ASSERTION = re.compile(r"^entry_ids=(.*)$")


def handler(event, context):
    """Score one TRACE: PASS when returned ids match the expected set."""
    expected = expected_entry_ids(event.get("evaluationReferenceInputs") or [])
    if expected is None:
        return {
            "errorCode": "MISSING_GROUND_TRUTH",
            "errorMessage": "No entry_ids= assertion in evaluationReferenceInputs.",
        }

    returned = returned_entry_ids(event.get("evaluationInput") or {})
    if returned == expected:
        return {
            "label": "PASS",
            "value": 1.0,
            "explanation": explanation(expected, returned),
        }
    return {
        "label": "FAIL",
        "value": 0.0,
        "explanation": explanation(expected, returned),
    }


def expected_entry_ids(reference_inputs):
    for item in reference_inputs:
        for assertion in assertions_from(item):
            ids = entry_ids_from_assertion(assertion)
            if ids is not None:
                return ids
    return None


def assertions_from(item):
    if not isinstance(item, dict):
        return []
    assertions = item.get("assertions")
    if isinstance(assertions, list):
        return [text_from(a) for a in assertions]
    text = text_from(item.get("assertion") or item.get("text") or item)
    return [text] if text else []


def text_from(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        text = value.get("text")
        if isinstance(text, str):
            return text.strip()
    return ""


def entry_ids_from_assertion(assertion):
    match = ENTRY_IDS_ASSERTION.match(assertion.strip())
    if match is None:
        return None
    raw = match.group(1).strip()
    if raw == "":
        return frozenset()
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def returned_entry_ids(evaluation_input):
    spans = evaluation_input.get("sessionSpans") or []
    from_tool = ids_from_tool_results(spans)
    if from_tool is not None:
        return from_tool
    return ids_from_answer(spans)


def ids_from_tool_results(spans):
    found = None
    for span in spans:
        if not isinstance(span, dict):
            continue
        attrs = span.get("attributes") or {}
        if attrs.get("gen_ai.tool.name") != "search_entries":
            continue
        result = attrs.get("gen_ai.tool.call.result")
        ids = ids_from_entries_json(result)
        if ids is None:
            continue
        found = ids if found is None else found | ids
    return found


def ids_from_entries_json(raw):
    if not isinstance(raw, str):
        return None
    try:
        entries = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(entries, list):
        return None
    ids = []
    for entry in entries:
        if isinstance(entry, dict) and entry.get("entryId"):
            ids.append(str(entry["entryId"]))
    return frozenset(ids)


def ids_from_answer(spans):
    ids = frozenset()
    for span in spans:
        if not isinstance(span, dict):
            continue
        if span.get("name") != "invoke_agent":
            continue
        attrs = span.get("attributes") or {}
        output = attrs.get("gen_ai.task.output")
        if isinstance(output, str):
            ids |= hyphenated_ids_in(output)
    return ids


def hyphenated_ids_in(text):
    return frozenset(re.findall(r"\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b", text))


def explanation(expected, returned):
    return (
        f"expected=[{','.join(sorted(expected))}] "
        f"returned=[{','.join(sorted(returned))}]"
    )
