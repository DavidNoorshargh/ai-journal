import pytest

from handler import handler


class Conflict(Exception):
    pass


class Boom(Exception):
    pass


class FakeBedrock:
    def __init__(self, error=None):
        self.error = error
        self.calls = []
        self.exceptions = type("Exceptions", (), {"ConflictException": Conflict})

    def start_ingestion_job(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error


def test_burst_starts_one_job(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_BASE_ID", "kb")
    monkeypatch.setenv("DATA_SOURCE_ID", "ds")
    client = FakeBedrock()

    result = handler({"Records": [{}, {}, {}]}, None, client=client)

    assert result == {"started": True}
    assert client.calls == [{"knowledgeBaseId": "kb", "dataSourceId": "ds"}]


def test_conflict_is_success(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_BASE_ID", "kb")
    monkeypatch.setenv("DATA_SOURCE_ID", "ds")
    client = FakeBedrock(error=Conflict())

    result = handler({"Records": [{}]}, None, client=client)

    assert result == {"started": False}
    assert len(client.calls) == 1


def test_other_errors_raise(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_BASE_ID", "kb")
    monkeypatch.setenv("DATA_SOURCE_ID", "ds")
    client = FakeBedrock(error=Boom())

    with pytest.raises(Boom):
        handler({"Records": [{}]}, None, client=client)


def test_empty_batch_does_not_start(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_BASE_ID", "kb")
    monkeypatch.setenv("DATA_SOURCE_ID", "ds")
    client = FakeBedrock()

    result = handler({"Records": []}, None, client=client)

    assert result == {"started": False}
    assert client.calls == []
