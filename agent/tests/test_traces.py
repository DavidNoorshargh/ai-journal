from datetime import date

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from main import invoke
from model import BedrockModel

_EXPORTER = InMemorySpanExporter()
_PROVIDER = TracerProvider()
_PROVIDER.add_span_processor(SimpleSpanProcessor(_EXPORTER))
trace.set_tracer_provider(_PROVIDER)


@pytest.fixture(autouse=True)
def clear_spans():
    _EXPORTER.clear()
    yield


class ScriptedModel:
    def __init__(self):
        self.cited_ids = []

    def choose_search(self, prompt):
        return {"toolUse": {"query": "lantern"}, "toolName": "search_entries"}

    def write_answer(self, prompt, entries):
        return "The note mentions a lantern."


class RecordingClient:
    def converse(self, **request):
        return {
            "output": {
                "message": {
                    "role": "assistant",
                    "content": [{"toolUse": {"name": "search_entries", "toolUseId": "1", "input": {"query": "x"}}}],
                }
            }
        }


def test_invoke_emits_agent_and_tool_spans():
    entries = [
        {"entryId": "fixture-1", "date": "20200101", "tags": ["life"], "text": "A blue lantern."}
    ]

    reply = invoke(
        {"question": "what about the lantern?"},
        search=lambda query, tags=None, start_date=None, end_date=None: entries,
        model=ScriptedModel(),
        today=date(2026, 10, 24),
    )

    spans = {span.name: span for span in _EXPORTER.get_finished_spans()}
    agent = spans["invoke_agent"]
    tool = spans["execute_tool search_entries"]

    assert reply["answer"] == "The note mentions a lantern."
    assert agent.attributes["gen_ai.operation.name"] == "invoke_agent"
    assert agent.attributes["gen_ai.task.input"] == "what about the lantern?"
    assert agent.attributes["gen_ai.task.output"] == "The note mentions a lantern."
    assert tool.attributes["gen_ai.operation.name"] == "execute_tool"
    assert tool.attributes["gen_ai.tool.name"] == "search_entries"
    assert "fixture-1" in tool.attributes["gen_ai.tool.call.result"]
    assert "A blue lantern." in tool.attributes["gen_ai.tool.call.result"]


def test_unsynced_notes_are_on_the_agent_span():
    invoke(
        {
            "question": "lantern",
            "unsyncedEntries": [
                {"id": "local-1", "date": "20261024", "tags": ["life"], "body": "Still packing."}
            ],
        },
        search=lambda query, tags=None, start_date=None, end_date=None: [],
        model=ScriptedModel(),
        today=date(2026, 10, 24),
    )

    agent = next(span for span in _EXPORTER.get_finished_spans() if span.name == "invoke_agent")
    assert "Still packing." in agent.attributes["gen_ai.task.input"]
    assert "local-1" in agent.attributes["gen_ai.task.input"]


def test_converse_emits_a_chat_span():
    model = BedrockModel(client=RecordingClient(), model_id="amazon.nova-lite-v1:0")

    model.choose_search("Question: lantern")

    chat_span = next(span for span in _EXPORTER.get_finished_spans() if span.name == "chat")
    assert chat_span.attributes["gen_ai.operation.name"] == "chat"
    assert "Question: lantern" in chat_span.attributes["gen_ai.input.messages"]
    assert "search_entries" in chat_span.attributes["gen_ai.output.messages"]
