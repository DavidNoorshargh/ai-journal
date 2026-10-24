import pytest

from main import search_entries


class FakeRetrieve:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def retrieve(self, **kwargs):
        self.calls.append(kwargs)
        return {"retrievalResults": self.results}


def test_query_without_filters():
    client = FakeRetrieve([])

    entries = search_entries("blue lantern", client=client, knowledge_base_id="kb")

    assert entries == []
    assert client.calls == [
        {
            "knowledgeBaseId": "kb",
            "retrievalQuery": {"text": "blue lantern"},
            "retrievalConfiguration": {"vectorSearchConfiguration": {"numberOfResults": 20}},
        }
    ]


def test_tags_and_date_range_are_a_filter():
    client = FakeRetrieve([])

    search_entries(
        "lantern",
        tags=["thoughts", "life"],
        start_date="20261001",
        end_date="20261024",
        client=client,
        knowledge_base_id="kb",
    )

    assert client.calls[0]["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"] == {
        "andAll": [
            {"greaterThanOrEquals": {"key": "date", "value": "20261001"}},
            {"lessThanOrEquals": {"key": "date", "value": "20261024"}},
            {
                "orAll": [
                    {"listContains": {"key": "tags", "value": "thoughts"}},
                    {"listContains": {"key": "tags", "value": "life"}},
                ]
            },
        ]
    }


def test_chunks_with_the_same_id_are_one_entry():
    client = FakeRetrieve(
        [
            {
                "content": {"text": "The fixture entry is about a blue paper lantern."},
                "metadata": {"entryId": "fixture-retrieval", "date": "20261024", "tags": ['"thoughts"']},
            },
            {
                "content": {"text": "It is only a retrieval check."},
                "metadata": {"entryId": "fixture-retrieval", "date": "20261024", "tags": ["thoughts"]},
            },
        ]
    )

    entries = search_entries("lantern", client=client, knowledge_base_id="kb")

    assert entries == [
        {
            "entryId": "fixture-retrieval",
            "date": "20261024",
            "tags": ["thoughts"],
            "text": "The fixture entry is about a blue paper lantern.\nIt is only a retrieval check.",
        }
    ]


def test_entry_id_can_come_from_the_object_key():
    client = FakeRetrieve(
        [
            {
                "content": {"text": "A note."},
                "location": {"s3Location": {"uri": "s3://bucket/entries/fixture-retrieval.md"}},
                "metadata": {},
            }
        ]
    )

    entries = search_entries("note", client=client, knowledge_base_id="kb")

    assert entries[0]["entryId"] == "fixture-retrieval"


def test_one_day_window_drops_other_days():
    client = FakeRetrieve(
        [
            {"content": {"text": "On the day."}, "metadata": {"entryId": "today", "date": "20261024"}},
            {"content": {"text": "The day before."}, "metadata": {"entryId": "yesterday", "date": "20261023"}},
        ]
    )

    entries = search_entries(
        "",
        start_date="20261024",
        end_date="20261024",
        client=client,
        knowledge_base_id="kb",
    )

    assert [entry["entryId"] for entry in entries] == ["today"]
    vector_search = client.calls[0]["retrievalConfiguration"]["vectorSearchConfiguration"]
    assert vector_search["numberOfResults"] == 100
    assert vector_search["filter"] == {
        "andAll": [
            {"greaterThanOrEquals": {"key": "date", "value": "20261024"}},
            {"lessThanOrEquals": {"key": "date", "value": "20261024"}},
        ]
    }


def test_dashed_dates_are_normalized():
    client = FakeRetrieve([])

    search_entries(
        "lantern",
        start_date="2026-10-24",
        end_date="2026-10-24",
        client=client,
        knowledge_base_id="kb",
    )

    date_filter = client.calls[0]["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"]
    assert date_filter["andAll"][0]["greaterThanOrEquals"]["value"] == "20261024"
    assert date_filter["andAll"][1]["lessThanOrEquals"]["value"] == "20261024"


def test_date_range_must_be_ordered():
    with pytest.raises(ValueError):
        search_entries("lantern", start_date="20261024", end_date="20261001", client=FakeRetrieve([]), knowledge_base_id="kb")
