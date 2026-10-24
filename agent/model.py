import json
import os


class BedrockModel:
    """One Converse call to choose the search, then one call to write the answer."""

    def __init__(self, client=None, model_id=None):
        self.client = client
        self.model_id = model_id or os.environ.get("MODEL_ID")
        self._tool_use = None

    def choose_search(self, prompt):
        parsed = _parse_converse(self._converse([_user_message(prompt)]))
        if "toolUseId" in parsed:
            self._tool_use = parsed
        return parsed

    def write_answer(self, prompt, entries):
        if self._tool_use is None:
            return ""

        messages = [
            _user_message(prompt),
            {"role": "assistant", "content": [{"toolUse": self._tool_use["raw"]}]},
            _user_tool_result(self._tool_use["toolUseId"], entries),
        ]
        parsed = _parse_converse(self._converse(messages))
        return parsed.get("text") or ""

    def _converse(self, messages):
        if self.client is None:
            import boto3

            self.client = boto3.client("bedrock-runtime")
        return self.client.converse(
            modelId=self.model_id,
            messages=messages,
            toolConfig={"tools": [_SEARCH_TOOL]},
        )


def _parse_converse(response):
    tool, texts = _converse_parts(response)
    if tool is not None:
        return _tool_use_reply(tool)
    return {"text": "\n".join(texts).strip()}


def _converse_parts(response):
    content = response["output"]["message"]["content"]
    tool = None
    texts = []
    for block in content:
        if "toolUse" in block and tool is None:
            tool = block["toolUse"]
        elif block.get("text"):
            texts.append(block["text"])
    return tool, texts


def _tool_use_reply(tool):
    return {
        "toolUse": tool.get("input") or {},
        "toolUseId": tool.get("toolUseId"),
        "toolName": tool.get("name") or "",
        "raw": tool,
    }


def _user_message(text):
    return {"role": "user", "content": [{"text": text}]}


def _user_tool_result(tool_use_id, entries):
    body = json.dumps(
        [
            {
                "entryId": entry["entryId"],
                "date": entry.get("date") or "",
                "tags": entry.get("tags") or [],
                "text": entry.get("text") or "",
            }
            for entry in entries
        ]
    )
    return {
        "role": "user",
        "content": [{"toolResult": {"toolUseId": tool_use_id, "content": [{"text": body}]}}],
    }


_SEARCH_TOOL = {
    "toolSpec": {
        "name": "search_entries",
        "description": "Search the journal once. An empty query with a date range returns the entries in that range.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "startDate": {"type": "string", "description": "YYYYMMDD"},
                    "endDate": {"type": "string", "description": "YYYYMMDD"},
                },
                "required": ["query"],
            }
        },
    }
}
