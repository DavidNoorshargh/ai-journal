import calendar
import json
import re
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from model import BedrockModel
from search import require_tags, search_entries

EMPTY_ANSWER = "The journal does not contain it."

# Entry ids are hyphenated tokens, such as fixture-retrieval.
_INVENTED_ID = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+")


def serve():
    ThreadingHTTPServer(("0.0.0.0", 8080), _Handler).serve_forever()


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] != "/ping":
            self.send_error(404)
            return
        self._send_json(200, {"status": "Healthy"})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/invocations":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            self._send_json(200, invoke(payload))
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"error": type(exc).__name__})

    def _send_json(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        return


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
    requested = _requested_search(model.choose_search(prompt))
    if requested is None:
        return _response("", [], unsynced)

    entries = search(
        requested.get("query") or "",
        tags=requested.get("tags") or None,
        start_date=_none_if_blank(requested.get("startDate")),
        end_date=_none_if_blank(requested.get("endDate")),
    )
    answer = model.write_answer(prompt, entries)
    return _response(answer, entries, unsynced)


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


def _unsynced_entry(entry):
    if not isinstance(entry, dict) or not entry.get("id"):
        raise ValueError("unsynced entry needs an id")
    return {
        "entryId": entry["id"],
        "date": entry.get("date") or "",
        "tags": require_tags(entry.get("tags")),
        "text": entry.get("body") or "",
    }


def _prompt(question, unsynced, today):
    lines = _instruction_lines(today)
    lines.extend(["", f"Question: {question}"])
    lines.extend(_unsynced_lines(unsynced))
    return "\n".join(lines)


def _instruction_lines(today):
    windows = time_windows(today)
    last_year = windows["last year"]
    last_week = windows["last week"]
    same_day = windows["this day last month"]
    return [
        f"Today is {_format_iso_date(today)}.",
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
    ]


def _unsynced_lines(unsynced):
    if not unsynced:
        return []
    lines = ["Unsynced entries, still only on the phone:"]
    for entry in unsynced:
        lines.append(f"{entry['entryId']} {entry['date']} {entry['text']}")
    return lines


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
        "last week": (_format_yyyymmdd(week_start), _format_yyyymmdd(week_end)),
        "this day last month": (_format_yyyymmdd(same_day), _format_yyyymmdd(same_day)),
    }


def _same_day_previous_month(today):
    month = today.month - 1
    year = today.year
    if month == 0:
        month = 12
        year -= 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(today.day, last_day))


def _format_yyyymmdd(value):
    return value.strftime("%Y%m%d")


def _format_iso_date(value):
    return value.isoformat()


def _requested_search(reply):
    if reply.get("toolName", "search_entries") != "search_entries":
        return None
    return reply.get("toolUse")


def _none_if_blank(value):
    if value is None or value == "":
        return None
    return value


def _response(answer, entries, unsynced):
    cited = _cited_unsynced(answer, entries, unsynced)
    if not entries and not cited:
        return {"answer": EMPTY_ANSWER, "entryIds": []}

    allowed = entries + cited
    return {
        "answer": _answer_text(answer, entries, allowed),
        "entryIds": [entry["entryId"] for entry in allowed],
    }


def _answer_text(answer, entries, allowed):
    text = _strip_invented_ids(answer, allowed)
    if entries:
        return _ensure_returned_count(text, len(entries))
    if not text.strip():
        return EMPTY_ANSWER
    return text


def _cited_unsynced(answer, entries, unsynced):
    known = {entry["entryId"] for entry in entries}
    return [entry for entry in unsynced if entry["entryId"] in answer and entry["entryId"] not in known]


def _ensure_returned_count(text, count):
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


if __name__ == "__main__":
    serve()
