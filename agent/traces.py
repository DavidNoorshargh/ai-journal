"""OpenTelemetry generative AI spans that AgentCore Evaluations can read."""

import json
from contextlib import contextmanager

from opentelemetry import baggage, context, trace

_SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"


def invoke_agent(question, unsynced, run):
    """One span for the question and the answer the phone receives."""
    with _span("invoke_agent", "invoke_agent") as span:
        span.set_attribute("gen_ai.task.input", invoke_input(question, unsynced))
        reply = run()
        span.set_attribute("gen_ai.task.output", reply["answer"])
        return reply


def invoke_input(question, unsynced):
    if not unsynced:
        return question
    lines = [question, "Unsynced entries, still only on the phone:"]
    for entry in unsynced:
        lines.append(f"{entry['entryId']} {entry['date']} {entry['text']}")
    return "\n".join(lines)


def execute_tool(query, tags, start_date, end_date, run):
    """One span for search_entries and the notes it returned."""
    with _span("execute_tool search_entries", "execute_tool") as span:
        span.set_attribute("gen_ai.tool.name", "search_entries")
        span.set_attribute("gen_ai.tool.call.arguments", tool_arguments(query, tags, start_date, end_date))
        entries = run()
        span.set_attribute("gen_ai.tool.call.result", json.dumps(entries))
        return entries


def tool_arguments(query, tags, start_date, end_date):
    return json.dumps(
        {
            "query": query,
            "tags": tags,
            "startDate": start_date,
            "endDate": end_date,
        }
    )


def chat(messages, run):
    """One span for a Converse call."""
    with _span("chat", "chat") as span:
        span.set_attribute("gen_ai.input.messages", json.dumps(messages))
        response = run()
        span.set_attribute("gen_ai.output.messages", assistant_messages(response))
        return response


def assistant_messages(response):
    return json.dumps([response.get("output", {}).get("message") or {}])


@contextmanager
def runtime_session(headers):
    """Bind runtimeSessionId so every span in this request carries session.id."""
    session_id = headers.get(_SESSION_HEADER)
    if not session_id:
        yield
        return
    token = context.attach(baggage.set_baggage("session.id", session_id))
    try:
        yield
    finally:
        context.detach(token)


@contextmanager
def _span(name, operation):
    with _tracer().start_as_current_span(name) as span:
        span.set_attribute("gen_ai.operation.name", operation)
        _stamp_session(span)
        yield span


def _stamp_session(span):
    session_id = baggage.get_baggage("session.id")
    if session_id:
        span.set_attribute("session.id", session_id)


def _tracer():
    return trace.get_tracer("opentelemetry.instrumentation.ai_journal")
