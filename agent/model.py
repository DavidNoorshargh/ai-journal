import json
import os


class BedrockModel:
    """One Converse call to choose the search, then one call to write the answer."""

    def __init__(self, client=None, model_id=None):
        self.client = client
        self.model_id = model_id or os.environ.get("MODEL_ID")
        self._tool_use = None
        self.cited_ids = []

    def choose_search(self, prompt):
        parsed = _parse_converse(self._converse([_user_message(prompt)]))
        if "toolUseId" in parsed:
            self._tool_use = parsed
        return parsed

    def write_answer(self, prompt, entries):
        parsed = _parse_converse(self._converse(_answer_messages(prompt, entries, self._tool_use), summary=True))
        self.cited_ids = _cited_ids(parsed)
        return _summary_text(parsed)

    def _converse(self, messages, tools=True, summary=False):
        if self.client is None:
            import boto3

            self.client = boto3.client("bedrock-runtime")
        request = {"modelId": self.model_id, "messages": messages}
        if summary:
            request["toolConfig"] = _SUMMARY_CONFIG
        elif tools:
            request["toolConfig"] = {"tools": [_SEARCH_TOOL]}
        return self.client.converse(**request)


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


def _answer_messages(prompt, entries, search_use):
    if search_use is None:
        return [_user_message(_entries_prompt(prompt, entries))]
    return [
        _user_message(prompt),
        {"role": "assistant", "content": [{"toolUse": search_use["raw"]}]},
        _user_tool_result(search_use["toolUseId"], entries),
    ]


def _summary_text(parsed):
    summary = (parsed.get("toolUse") or {}).get("summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    return parsed.get("text") or ""


def _cited_ids(parsed):
    raw = (parsed.get("toolUse") or {}).get("entryIds")
    if not isinstance(raw, list):
        return []
    return [entry_id for entry_id in raw if isinstance(entry_id, str)]


def _user_message(text):
    return {"role": "user", "content": [{"text": text}]}


def _user_tool_result(tool_use_id, entries):
    return {
        "role": "user",
        "content": [{"toolResult": {"toolUseId": tool_use_id, "content": [{"text": _entries_json(entries)}]}}],
    }


def _entries_prompt(prompt, entries):
    return f"{prompt}\n\nEntries returned:\n{_entries_json(entries)}"


def _entries_json(entries):
    return json.dumps(
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


_SUMMARY_TOOL = {
    "toolSpec": {
        "name": "write_summary",
        "description": "Return the one-paragraph summary of the notes that were found.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "One short paragraph about what the notes say. Do not paste the note text, ids, dates, tags, or a count.",
                    },
                    "entryIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Ids of unsynced notes used in the summary. Omit every other id.",
                    },
                },
                "required": ["summary"],
            }
        },
    }
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
                    "startDate": {
                        "type": "string",
                        "description": "YYYYMMDD. Omit unless the question names a time.",
                    },
                    "endDate": {
                        "type": "string",
                        "description": "YYYYMMDD. Omit unless the question names a time.",
                    },
                },
                "required": ["query"],
            }
        },
    }
}

_SUMMARY_CONFIG = {
    "tools": [_SEARCH_TOOL, _SUMMARY_TOOL],
    "toolChoice": {"tool": {"name": "write_summary"}},
}
