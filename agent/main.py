import calendar
import json
import os
import re
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# A week of notes fits in one reply. A time-only window asks for every entry in range.
RESULTS_LIMIT = 20
TIME_ONLY_LIMIT = 100
EMPTY_ANSWER = "The journal does not contain it."

_INVENTED_ID = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+")


def time_windows(today):
    """The three phrases the prompt defines, resolved from a known today."""
    if not isinstance(today, date):
        today = date.fromisoformat(today)

    previous_year = today.year - 1
    week_end = today - timedelta(days=1)
    week_start = today - timedelta(days=7)
    same_day = _same_day_previous_month(today)
    return {
        "last year": (f"{previous_year}0101", f"{previous_year}1231"),
        "last week": (_ymd(week_start), _ymd(week_end)),
        "this day last month": (_ymd(same_day), _ymd(same_day)),
    }


def search_entries(query, tags=None, start_date=None, end_date=None, *, client=None, knowledge_base_id=None):
    """Retrieve whole entries for one query. A date range is a metadata filter, applied before ranking.

    An empty query with a date range is a time-only search: return the entries in that window.
    """
    if not isinstance(query, str):
        raise ValueError("query is required")

    tags = _tags(tags)
    start_date = _date(start_date, "start_date")
    end_date = _date(end_date, "end_date")
    if start_date and end_date and start_date > end_date:
        raise ValueError("start_date must be on or before end_date")

    time_only = not query.strip()
    if time_only and not (start_date or end_date):
        raise ValueError("query is required")

    if client is None:
        import boto3

        client = boto3.client("bedrock-agent-runtime")

    vector_search = {"numberOfResults": TIME_ONLY_LIMIT if time_only else RESULTS_LIMIT}
    metadata_filter = _metadata_filter(tags, start_date, end_date)
    if metadata_filter is not None:
        vector_search["filter"] = metadata_filter

    response = client.retrieve(
        knowledgeBaseId=knowledge_base_id or os.environ["KNOWLEDGE_BASE_ID"],
        retrievalQuery={"text": query.strip() or "journal entry"},
        retrievalConfiguration={"vectorSearchConfiguration": vector_search},
    )
    entries = _whole_entries(response.get("retrievalResults") or [])
    if start_date or end_date:
        entries = [entry for entry in entries if _in_range(entry.get("date") or "", start_date, end_date)]
    return entries


def parse_request(payload):
    """Read a question and any entries still only on the phone."""
    if not isinstance(payload, dict):
        raise ValueError("request must be an object")

    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        raise ValueError("question is required")

    unsynced = payload.get("unsyncedEntries") or []
    if not isinstance(unsynced, list):
        raise ValueError("unsyncedEntries must be a list")

    return question.strip(), [_unsynced_entry(entry) for entry in unsynced]


def invoke(payload, *, search=None, model=None, today=None):
    """Answer a question. The model may call search_entries once. Entry ids come from that call."""
    question, unsynced = parse_request(payload)
    if search is None:
        search = search_entries
    if model is None:
        model = BedrockModel()
    if today is None:
        today = date.today()

    prompt = _prompt(question, unsynced, today)
    first = model.complete(prompt, None)
    tool = first.get("toolUse") if first.get("toolName", "search_entries") == "search_entries" else None

    entries = []
    answer = ""
    if tool is not None:
        entries = search(
            tool.get("query") or "",
            tags=tool.get("tags") or None,
            start_date=_blank(tool.get("startDate")),
            end_date=_blank(tool.get("endDate")),
        )
        follow_up = model.complete(prompt, {"entries": entries})
        answer = follow_up.get("text") or ""

    return _response(answer, entries, unsynced)


class BedrockModel:
    """One Converse call to choose the search, then one call to write the answer."""

    def __init__(self, client=None, model_id=None):
        self.client = client
        self.model_id = model_id or os.environ.get("MODEL_ID")
        self._tool_use = None

    def complete(self, prompt, tool_result):
        if self.client is None:
            import boto3

            self.client = boto3.client("bedrock-runtime")

        if tool_result is None:
            parsed = _parse_converse(self._converse([_user(prompt)]))
            if "toolUseId" in parsed:
                self._tool_use = parsed
            return parsed

        if self._tool_use is None:
            return {"text": ""}

        messages = [
            _user(prompt),
            {"role": "assistant", "content": [{"toolUse": self._tool_use["raw"]}]},
            _user_tool_result(self._tool_use["toolUseId"], tool_result["entries"]),
        ]
        parsed = _parse_converse(self._converse(messages))
        return {"text": parsed.get("text") or ""}

    def _converse(self, messages):
        return self.client.converse(
            modelId=self.model_id,
            messages=messages,
            toolConfig={"tools": [_SEARCH_TOOL]},
        )


def _response(answer, entries, unsynced):
    if not entries and not any(entry["entryId"] in answer for entry in unsynced):
        return {"answer": EMPTY_ANSWER, "entryIds": []}

    cited_unsynced = [entry for entry in unsynced if entry["entryId"] in answer and entry["entryId"] not in {item["entryId"] for item in entries}]
    allowed = entries + cited_unsynced
    text = _strip_invented_ids(answer, allowed)
    if entries:
        text = _with_count(text, len(entries))
    elif not text.strip():
        text = EMPTY_ANSWER
    return {
        "answer": text,
        "entryIds": [entry["entryId"] for entry in allowed],
    }


def _prompt(question, unsynced, today):
    windows = time_windows(today)
    last_year = windows["last year"]
    last_week = windows["last week"]
    same_day = windows["this day last month"]
    lines = [
        f"Today is {_iso(today)}.",
        f"last year means {last_year[0]} through {last_year[1]}, the previous calendar year.",
        f"last week means {last_week[0]} through {last_week[1]}, the previous seven days, not including today.",
        f"this day last month means {same_day[0]}.",
        "Call search_entries once.",
        "When the question is about a time and not a subject, pass an empty query and that date range so every entry in the window can be returned.",
        "When the question has a subject, rewrite it into a short query. Include the date range when a time was mentioned.",
        "Then list those entries, summarise them, or draw a conclusion from what they say.",
        "A summary or a conclusion says how many entries were returned.",
        "Quote entries. Do not infer personality, politics, or mental health unless an entry states it.",
        "Do not mention an entry id that was not returned or listed below.",
        f"If the search returns nothing and none of the unsynced entries answer it, say exactly: {EMPTY_ANSWER}",
        "",
        f"Question: {question}",
    ]
    if unsynced:
        lines.append("Unsynced entries, still only on the phone:")
        for entry in unsynced:
            lines.append(f"{entry['entryId']} {entry['date']} {entry['text']}")
    return "\n".join(lines)


def _with_count(text, count):
    sentence = "1 entry was returned." if count == 1 else f"{count} entries were returned."
    if sentence in text:
        return text.strip()
    return f"{text.rstrip()}\n{sentence}".strip()


def _strip_invented_ids(text, entries):
    allowed = {entry["entryId"] for entry in entries}
    corpus = "\n".join(entry.get("text") or "" for entry in entries)

    def replace(match):
        token = match.group(0)
        if token in allowed or token in corpus:
            return token
        return ""

    return _INVENTED_ID.sub(replace, text).strip()


def _blank(value):
    if value is None or value == "":
        return None
    return value


def _user(text):
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


def _parse_converse(response):
    content = response["output"]["message"]["content"]
    tool = None
    texts = []
    for block in content:
        if "toolUse" in block and tool is None:
            tool = block["toolUse"]
        elif block.get("text"):
            texts.append(block["text"])
    if tool is not None:
        return {
            "toolUse": tool.get("input") or {},
            "toolUseId": tool.get("toolUseId"),
            "toolName": tool.get("name") or "",
            "raw": tool,
        }
    return {"text": "\n".join(texts).strip()}


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


def _same_day_previous_month(today):
    month = today.month - 1
    year = today.year
    if month == 0:
        month = 12
        year -= 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(today.day, last_day))


def _ymd(value):
    return value.strftime("%Y%m%d")


def _iso(value):
    return value.isoformat()


def _in_range(entry_date, start_date, end_date):
    if len(entry_date) != 8 or not entry_date.isdigit():
        return False
    if start_date and entry_date < start_date:
        return False
    if end_date and entry_date > end_date:
        return False
    return True


def _unsynced_entry(entry):
    if not isinstance(entry, dict) or not entry.get("id"):
        raise ValueError("unsynced entry needs an id")
    return {
        "entryId": entry["id"],
        "date": entry.get("date") or "",
        "tags": _tags(entry.get("tags")),
        "text": entry.get("body") or "",
    }


def _tags(tags):
    if tags is None:
        return []
    if isinstance(tags, str) or not isinstance(tags, list):
        raise ValueError("tags must be a list of strings")
    if not all(isinstance(tag, str) and tag.strip() for tag in tags):
        raise ValueError("tags must be a list of strings")
    return [tag.strip() for tag in tags]


def _date(value, name):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be YYYYMMDD")
    digits = value.replace("-", "")
    if len(digits) != 8 or not digits.isdigit():
        raise ValueError(f"{name} must be YYYYMMDD")
    return digits


def _metadata_filter(tags, start_date, end_date):
    parts = []
    if start_date:
        parts.append({"greaterThanOrEquals": {"key": "date", "value": start_date}})
    if end_date:
        parts.append({"lessThanOrEquals": {"key": "date", "value": end_date}})
    if len(tags) == 1:
        parts.append({"listContains": {"key": "tags", "value": tags[0]}})
    elif len(tags) > 1:
        parts.append({"orAll": [{"listContains": {"key": "tags", "value": tag}} for tag in tags]})

    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return {"andAll": parts}


def _whole_entries(results):
    entries = {}
    order = []
    for result in results:
        metadata = result.get("metadata") or {}
        entry_id = metadata.get("entryId") or _entry_id_from_location(result.get("location") or {})
        if not entry_id:
            continue

        text = ((result.get("content") or {}).get("text")) or ""
        if entry_id not in entries:
            entries[entry_id] = {
                "entryId": entry_id,
                "date": metadata.get("date") or "",
                "tags": _clean_tags(metadata.get("tags")),
                "text": text,
            }
            order.append(entry_id)
            continue

        existing = entries[entry_id]
        if text and text not in existing["text"]:
            existing["text"] = f"{existing['text']}\n{text}".strip()
    return [entries[entry_id] for entry_id in order]


def _entry_id_from_location(location):
    uri = ((location.get("s3Location") or {}).get("uri")) or ""
    name = uri.rsplit("/", 1)[-1]
    if name.endswith(".md"):
        return name[: -len(".md")]
    return ""


def _clean_tags(tags):
    if tags is None:
        return []
    if isinstance(tags, str):
        tags = [tags]
    cleaned = []
    for tag in tags:
        if not isinstance(tag, str):
            continue
        tag = tag.strip()
        if len(tag) >= 2 and tag[0] == '"' and tag[-1] == '"':
            tag = tag[1:-1]
        if tag:
            cleaned.append(tag)
    return cleaned


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] != "/ping":
            self.send_error(404)
            return
        self._json(200, {"status": "Healthy"})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/invocations":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            self._json(200, invoke(payload))
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:
            self._json(500, {"error": type(exc).__name__})

    def _json(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        return


def serve():
    ThreadingHTTPServer(("0.0.0.0", 8080), _Handler).serve_forever()


if __name__ == "__main__":
    serve()
