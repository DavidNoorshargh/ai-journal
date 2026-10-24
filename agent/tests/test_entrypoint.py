from datetime import date

import pytest

from main import invoke, parse_request


class ScriptedModel:
    def __init__(self, tool, text):
        self.tool = tool
        self.text = text
        self.prompts = []
        self.results = []

    def choose_search(self, prompt):
        self.prompts.append(prompt)
        return {"toolUse": self.tool, "toolName": "search_entries"}

    def write_answer(self, prompt, entries):
        self.results.append({"entries": entries})
        return self.text


def test_question_and_unsynced_entries_are_read():
    question, unsynced = parse_request(
        {
            "question": "  what about the lantern? ",
            "unsyncedEntries": [
                {"id": "local-1", "date": "20261024", "tags": ["life"], "body": "Still on the phone."}
            ],
        }
    )

    assert question == "what about the lantern?"
    assert unsynced == [
        {"entryId": "local-1", "date": "20261024", "tags": ["life"], "text": "Still on the phone."}
    ]


def test_defined_phrases_are_in_the_prompt():
    model = ScriptedModel({"query": "lantern"}, "The note mentions a lantern.")

    invoke(
        {"question": "what about the lantern last week?"},
        search=lambda query, tags=None, start_date=None, end_date=None: [],
        model=model,
        today=date(2026, 10, 24),
    )

    prompt = model.prompts[0]
    assert "last week means 20261017 through 20261023" in prompt
    assert "this day last month means 20260924" in prompt
    assert "last year means 20250101 through 20251231" in prompt


def test_search_is_called_once_with_the_model_range():
    calls = []

    def search(query, tags=None, start_date=None, end_date=None):
        calls.append((query, tags, start_date, end_date))
        return [
            {
                "entryId": "fixture-retrieval",
                "date": "20261024",
                "tags": ["thoughts"],
                "text": "The fixture entry is about a blue paper lantern.",
            }
        ]

    model = ScriptedModel(
        {"query": "lantern", "startDate": "20261024", "endDate": "20261024"},
        "The note mentions a lantern. See invented-id.",
    )
    result = invoke(
        {
            "question": "lantern",
            "unsyncedEntries": [{"id": "local-1", "date": "20261024", "tags": ["life"], "body": "Still on the phone."}],
        },
        search=search,
        model=model,
        today=date(2026, 10, 24),
    )

    assert calls == [("lantern", None, "20261024", "20261024")]
    assert result["entryIds"] == ["fixture-retrieval"]
    assert "invented-id" not in result["answer"]
    assert "1 entry was returned." in result["answer"]
    assert "Still on the phone." in model.prompts[0]


def test_empty_search_cites_nothing():
    model = ScriptedModel({"query": "politics"}, "You seem anxious about politics. See invented-id.")
    result = invoke(
        {"question": "politics"},
        search=lambda query, tags=None, start_date=None, end_date=None: [],
        model=model,
        today=date(2026, 10, 24),
    )

    assert result == {"answer": "The journal does not contain it.", "entryIds": []}


def test_unsynced_id_can_be_cited_when_the_model_uses_it():
    model = ScriptedModel({"query": "phone"}, "local-1 is still on the phone.")
    result = invoke(
        {
            "question": "what did I just write?",
            "unsyncedEntries": [{"id": "local-1", "date": "20261024", "tags": ["life"], "body": "Still on the phone."}],
        },
        search=lambda query, tags=None, start_date=None, end_date=None: [],
        model=model,
        today=date(2026, 10, 24),
    )

    assert result["entryIds"] == ["local-1"]
    assert "local-1" in result["answer"]


def test_question_is_required():
    with pytest.raises(ValueError):
        invoke({"unsyncedEntries": []}, search=lambda **kwargs: [], model=ScriptedModel({"query": "x"}, ""))
