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


def test_unsynced_title_is_part_of_the_text():
    _, unsynced = parse_request(
        {
            "question": "lantern",
            "unsyncedEntries": [
                {
                    "id": "local-1",
                    "date": "20261024",
                    "tags": [],
                    "title": "Blue lantern",
                    "body": "On the table.",
                }
            ],
        }
    )

    assert unsynced[0]["text"] == "Blue lantern\nOn the table."


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
    assert "Omit startDate and endDate unless the question itself names a time." in prompt
    assert "Write one short paragraph about what the notes say." in prompt
    assert "Do not say how many notes matched." in prompt
    assert "Do not quote the notes, and do not paste their text." in prompt
    assert "Do not write a thinking block." in prompt


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
            "question": "lantern last week",
            "unsyncedEntries": [{"id": "local-1", "date": "20261024", "tags": ["life"], "body": "Still on the phone."}],
        },
        search=search,
        model=model,
        today=date(2026, 10, 24),
    )

    assert calls == [("lantern", None, "20261024", "20261024")]
    assert result["entryIds"] == ["fixture-retrieval"]
    assert "invented-id" not in result["answer"]
    assert "1 entry was returned." not in result["answer"]
    assert "Still on the phone." in model.prompts[0]


def test_a_question_with_no_time_drops_the_model_dates():
    calls = []

    def search(query, tags=None, start_date=None, end_date=None):
        calls.append((query, tags, start_date, end_date))
        return []

    model = ScriptedModel(
        {"query": "SDET Interview", "startDate": "20261006", "endDate": "20261006"},
        "The journal does not contain it.",
    )
    invoke(
        {"question": "What do you think about my SDET Interview"},
        search=search,
        model=model,
        today=date(2026, 11, 6),
    )

    assert calls == [("SDET Interview", None, None, None)]


def test_a_blank_query_searches_the_question():
    calls = []

    def search(query, tags=None, start_date=None, end_date=None):
        calls.append((query, tags, start_date, end_date))
        return []

    invoke(
        {"question": "SDET Interview"},
        search=search,
        model=ScriptedModel({"query": " ", "startDate": "20230101", "endDate": "20261106"}, ""),
        today=date(2026, 11, 6),
    )

    assert calls == [("SDET Interview", None, None, None)]


def test_a_missing_search_uses_the_question():
    calls = []

    def search(query, tags=None, start_date=None, end_date=None):
        calls.append((query, tags, start_date, end_date))
        return []

    invoke(
        {"question": "SDET Interview"},
        search=search,
        model=ScriptedModel(None, ""),
        today=date(2026, 11, 6),
    )

    assert calls == [("SDET Interview", None, None, None)]


def test_punctuation_is_not_a_query():
    calls = []

    def search(query, tags=None, start_date=None, end_date=None):
        calls.append((query, tags, start_date, end_date))
        return []

    invoke(
        {"question": "SDET Interview"},
        search=search,
        model=ScriptedModel({"query": "."}, ""),
        today=date(2026, 11, 6),
    )

    assert calls == [("SDET Interview", None, None, None)]


def test_a_time_only_question_keeps_a_blank_query():
    calls = []

    def search(query, tags=None, start_date=None, end_date=None):
        calls.append((query, tags, start_date, end_date))
        return []

    invoke(
        {"question": "what happened last week?"},
        search=search,
        model=ScriptedModel({"query": "", "startDate": "20261017", "endDate": "20261023"}, ""),
        today=date(2026, 10, 24),
    )

    assert calls == [("", None, "20261017", "20261023")]


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
    assert "local-1" not in result["answer"]
    assert "still on the phone" in result["answer"]


def test_a_thinking_block_is_left_out_of_the_answer():
    model = ScriptedModel(
        {"query": "lantern"},
        "<thinking>The note is about a lantern.</thinking>\nThe note mentions a lantern.",
    )
    result = invoke(
        {"question": "lantern"},
        search=lambda query, tags=None, start_date=None, end_date=None: [
            {"entryId": "fixture-retrieval", "date": "20261024", "tags": ["thoughts"], "text": "A lantern."}
        ],
        model=model,
        today=date(2026, 10, 24),
    )

    assert "<thinking>" not in result["answer"]
    assert "The note mentions a lantern." in result["answer"]


def test_an_entry_count_is_left_out_of_the_answer():
    model = ScriptedModel(
        {"query": "lantern"},
        "The note mentions a lantern. There is 1 entry about the lantern.\n1 entry was returned.",
    )
    result = invoke(
        {"question": "lantern"},
        search=lambda query, tags=None, start_date=None, end_date=None: [
            {"entryId": "fixture-retrieval", "date": "20261024", "tags": ["thoughts"], "text": "A lantern."}
        ],
        model=model,
        today=date(2026, 10, 24),
    )

    assert result["answer"] == "The note mentions a lantern."


def test_a_quoted_note_is_left_out_of_the_answer():
    model = ScriptedModel(
        {"query": "lantern"},
        "One note matches. It mentions a lantern.\n> The fixture entry is about a blue paper lantern.",
    )
    result = invoke(
        {"question": "lantern"},
        search=lambda query, tags=None, start_date=None, end_date=None: [
            {"entryId": "fixture-retrieval", "date": "20261024", "tags": ["thoughts"], "text": "A lantern."}
        ],
        model=model,
        today=date(2026, 10, 24),
    )

    assert ">" not in result["answer"]
    assert "blue paper lantern" not in result["answer"]
    assert "One note matches." in result["answer"]


def test_a_copied_note_is_left_out_of_the_summary():
    note = "Today I had an initial interview with a company called MillTech for an SDET role and the salary was low."
    model = ScriptedModel({"query": "interview"}, f"You were overqualified for the role. {note}")
    result = invoke(
        {"question": "interview"},
        search=lambda query, tags=None, start_date=None, end_date=None: [
            {"entryId": "note-1", "date": "20261106", "tags": ["work"], "text": note}
        ],
        model=model,
        today=date(2026, 11, 6),
    )

    assert result["answer"] == "You were overqualified for the role."
    assert result["entryIds"] == ["note-1"]


def test_a_schema_id_cites_an_unsynced_note_and_ignores_an_invented_one():
    model = ScriptedModel({"query": "phone"}, "It is still only on the phone.")
    model.cited_ids = ["local-1", "invented-id"]
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
    assert "invented-id" not in result["answer"]


def test_question_is_required():
    with pytest.raises(ValueError):
        invoke({"unsyncedEntries": []}, search=lambda **kwargs: [], model=ScriptedModel({"query": "x"}, ""))
