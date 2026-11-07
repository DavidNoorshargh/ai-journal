from model import BedrockModel


class RecordingClient:
    def __init__(self, response):
        self.response = response
        self.requests = []

    def converse(self, **request):
        self.requests.append(request)
        return self.response


def test_the_summary_is_the_schema_field_and_the_tool_is_required():
    client = RecordingClient(
        {
            "output": {
                "message": {
                    "content": [
                        {
                            "toolUse": {
                                "name": "write_summary",
                                "toolUseId": "summary-1",
                                "input": {"summary": "  One note matches.  ", "entryIds": ["local-1"]},
                            }
                        }
                    ]
                }
            }
        }
    )
    model = BedrockModel(client=client, model_id="amazon.nova-lite-v1:0")
    model._tool_use = {
        "raw": {"name": "search_entries", "toolUseId": "search-1", "input": {"query": "lantern"}},
        "toolUseId": "search-1",
    }

    summary = model.write_answer("Prompt", [{"entryId": "fixture", "text": "A lantern."}])

    assert summary == "One note matches."
    assert model.cited_ids == ["local-1"]
    choice = client.requests[0]["toolConfig"]["toolChoice"]
    assert choice == {"tool": {"name": "write_summary"}}
