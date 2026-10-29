import os

# A week of notes fits in one reply. A time-only window asks for every entry in range.
RESULTS_LIMIT = 20
TIME_ONLY_LIMIT = 100


def search_entries(query, tags=None, start_date=None, end_date=None, *, client=None, knowledge_base_id=None):
    """Retrieve whole entries for one query. A date range is a metadata filter, applied before ranking.

    An empty query with a date range is a time-only search: return the entries in that window.
    """
    query, tags, start_date, end_date = _prepare_search(query, tags, start_date, end_date)
    results = _retrieve(query, tags, start_date, end_date, client, knowledge_base_id)
    entries = _whole_entries(results)
    if not (start_date or end_date):
        return entries
    return [entry for entry in entries if _date_in_window(entry.get("date") or "", start_date, end_date)]


def require_tags(tags):
    if tags is None:
        return []
    if isinstance(tags, str) or not isinstance(tags, list):
        raise ValueError("tags must be a list of strings")
    if not all(isinstance(tag, str) and tag.strip() for tag in tags):
        raise ValueError("tags must be a list of strings")
    return [tag.strip() for tag in tags]


def _prepare_search(query, tags, start_date, end_date):
    if not isinstance(query, str):
        raise ValueError("query is required")

    tags = require_tags(tags)
    start_date = _require_yyyymmdd(start_date, "start_date")
    end_date = _require_yyyymmdd(end_date, "end_date")
    if start_date and end_date and start_date > end_date:
        raise ValueError("start_date must be on or before end_date")
    if not query.strip() and not (start_date or end_date):
        raise ValueError("query is required")
    return query, tags, start_date, end_date


def _retrieve(query, tags, start_date, end_date, client, knowledge_base_id):
    response = _knowledge_base_client(client).retrieve(
        knowledgeBaseId=knowledge_base_id or os.environ["KNOWLEDGE_BASE_ID"],
        retrievalQuery={"text": query.strip() or "journal entry"},
        retrievalConfiguration={
            "vectorSearchConfiguration": _vector_search_configuration(query, tags, start_date, end_date)
        },
    )
    return response.get("retrievalResults") or []


def _knowledge_base_client(client):
    if client is not None:
        return client
    import boto3

    return boto3.client("bedrock-agent-runtime")


def _vector_search_configuration(query, tags, start_date, end_date):
    time_only = not query.strip()
    configuration = {"numberOfResults": TIME_ONLY_LIMIT if time_only else RESULTS_LIMIT}
    metadata_filter = _metadata_filter(tags, start_date, end_date)
    if metadata_filter is not None:
        configuration["filter"] = metadata_filter
    return configuration


def _metadata_filter(tags, start_date, end_date):
    parts = _date_clauses(start_date, end_date)
    tag_clause = _tag_clause(tags)
    if tag_clause is not None:
        parts.append(tag_clause)

    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return {"andAll": parts}


def _date_clauses(start_date, end_date):
    clauses = []
    if start_date:
        clauses.append({"greaterThanOrEquals": {"key": "date", "value": start_date}})
    if end_date:
        clauses.append({"lessThanOrEquals": {"key": "date", "value": end_date}})
    return clauses


def _tag_clause(tags):
    if len(tags) == 1:
        return {"listContains": {"key": "tags", "value": tags[0]}}
    if len(tags) > 1:
        return {"orAll": [{"listContains": {"key": "tags", "value": tag}} for tag in tags]}
    return None


def _whole_entries(results):
    entries = {}
    order = []
    for result in results:
        entry_id = _result_entry_id(result)
        if not entry_id:
            continue
        text = ((result.get("content") or {}).get("text")) or ""
        if entry_id not in entries:
            entries[entry_id] = _new_entry(entry_id, result.get("metadata") or {}, text)
            order.append(entry_id)
            continue
        _append_entry_text(entries[entry_id], text)
    return [entries[entry_id] for entry_id in order]


def _result_entry_id(result):
    metadata = result.get("metadata") or {}
    return metadata.get("entryId") or _entry_id_from_location(result.get("location") or {})


def _new_entry(entry_id, metadata, text):
    return {
        "entryId": entry_id,
        "date": metadata.get("date") or "",
        "tags": _metadata_tags(metadata.get("tags")),
        "text": text,
    }


def _append_entry_text(entry, text):
    if text and text not in entry["text"]:
        entry["text"] = f"{entry['text']}\n{text}".strip()


def _entry_id_from_location(location):
    uri = ((location.get("s3Location") or {}).get("uri")) or ""
    name = uri.rsplit("/", 1)[-1]
    if name.endswith(".md"):
        return name[: -len(".md")]
    return ""


def _metadata_tags(tags):
    if tags is None:
        return []
    if isinstance(tags, str):
        tags = [tags]
    cleaned = []
    for tag in tags:
        tag = _tag_without_wrapping_quotes(tag)
        if tag:
            cleaned.append(tag)
    return cleaned


def _tag_without_wrapping_quotes(tag):
    if not isinstance(tag, str):
        return ""
    tag = tag.strip()
    if len(tag) >= 2 and tag[0] == '"' and tag[-1] == '"':
        return tag[1:-1]
    return tag


def _date_in_window(entry_date, start_date, end_date):
    if len(entry_date) != 8 or not entry_date.isdigit():
        return False
    if start_date and entry_date < start_date:
        return False
    if end_date and entry_date > end_date:
        return False
    return True


def _require_yyyymmdd(value, name):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be YYYYMMDD")
    digits = value.replace("-", "")
    if len(digits) != 8 or not digits.isdigit():
        raise ValueError(f"{name} must be YYYYMMDD")
    return digits
