import json
import sys
import time
from datetime import datetime, timezone

SOURCE_NAME = "ai-journal"
WRITER_MODEL = "amazon.nova-lite-v1:0"
JUDGE_MODEL = "eu.amazon.nova-pro-v1:0"
QUESTION = "What does the fixture note say?"
ADDED_SENTENCE = "This sentence was added and is not in the note."
FIXTURE_KEY = "entries/fixture-retrieval.md"
REGION = "eu-west-2"


def dataset(passage):
    faithful = paragraph(passage)
    return _jsonl([
        _turn(faithful, faithful, passage),
        _turn(f"{faithful} {ADDED_SENTENCE}", faithful, passage),
    ])


def paragraph(passage):
    text = " ".join(passage.split())
    if not text:
        raise ValueError("passage is required")
    return text


def job_name(moment):
    return moment.strftime("ai-journal-faithfulness-%Y%m%d%H%M%S")


def job_request(role_arn, dataset_uri, output_uri, name):
    return {
        "jobName": name,
        "roleArn": role_arn,
        "applicationType": "RagEvaluation",
        "evaluationConfig": {
            "automated": {
                "datasetMetricConfigs": [{
                    "taskType": "General",
                    "dataset": {
                        "name": "faithfulness",
                        "datasetLocation": {"s3Uri": dataset_uri},
                    },
                    "metricNames": ["Builtin.Faithfulness"],
                }],
                "evaluatorModelConfig": {
                    "bedrockEvaluatorModels": [{"modelIdentifier": JUDGE_MODEL}],
                },
            }
        },
        "inferenceConfig": {
            "ragConfigs": [{
                "precomputedRagSourceConfig": {
                    "retrieveAndGenerateSourceConfig": {
                        "ragSourceIdentifier": SOURCE_NAME,
                    }
                }
            }]
        },
        "outputDataConfig": {"s3Uri": output_uri},
    }


def faithfulness_scores(record):
    scores = record.get("automatedEvaluationResult", {}).get("scores", [])
    return [
        {"score": score.get("result"), "explanation": _explanation(score)}
        for score in scores
        if score.get("metricName") == "Builtin.Faithfulness"
    ]


def scores_from_body(body):
    found = []
    for line in body.splitlines():
        record = _record(line)
        if record is not None:
            found.extend(faithfulness_scores(record))
    if found:
        return found
    record = _record(body)
    if record is None:
        return []
    return faithfulness_scores(record)


def submit():
    try:
        _submit()
    except Exception as exc:
        error = getattr(exc, "response", {}).get("Error", {})
        if error:
            raise SystemExit(f"{error.get('Code')}: {error.get('Message')}") from None
        raise


def show_scores(job_arn):
    session = _session()
    for row in _finished_scores(session, job_arn):
        _print_score(row)


def main(argv):
    command = argv[1] if len(argv) > 1 else ""
    if command == "submit":
        submit()
        return
    if command == "scores" and len(argv) == 3:
        show_scores(argv[2])
        return
    raise SystemExit("usage: faithfulness.py submit | faithfulness.py scores <job-arn>")


def _turn(answer, reference, passage):
    return {
        "conversationTurns": [{
            "prompt": {"content": [{"text": QUESTION}]},
            "referenceResponses": [{"content": [{"text": reference}]}],
            "output": {
                "text": answer,
                "modelIdentifier": WRITER_MODEL,
                "knowledgeBaseIdentifier": SOURCE_NAME,
                "retrievedPassages": {
                    "retrievalResults": [{"content": {"text": passage}}]
                },
            },
        }]
    }


def _jsonl(rows):
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


def _record(text):
    try:
        record = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(record, dict):
        return record
    return None


def _explanation(score):
    details = score.get("evaluatorDetails") or []
    if not details:
        return ""
    return details[0].get("explanation") or ""


def _submit():
    session = _session()
    account = _account_id(session)
    name = job_name(datetime.now(timezone.utc))
    passage = _fixture_text(session, account)
    dataset_uri = _upload_dataset(session, account, name, dataset(passage))
    request = job_request(_role_arn(account), dataset_uri, _output_uri(account, name), name)
    job_arn = _start_job(session, request)
    print(job_arn, flush=True)
    rows = _finished_scores(session, job_arn)
    if not rows:
        raise SystemExit("no faithfulness scores in the result")
    for row in rows:
        _print_score(row)


def _session():
    import boto3

    return boto3.Session(region_name=REGION)


def _account_id(session):
    return session.client("sts").get_caller_identity()["Account"]


def _fixture_text(session, account):
    response = session.client("s3").get_object(
        Bucket=f"ai-journal-entries-{account}",
        Key=FIXTURE_KEY,
    )
    return response["Body"].read().decode("utf-8")


def _upload_dataset(session, account, name, body):
    key = f"eval/faithfulness/input/{name}.jsonl"
    session.client("s3").put_object(
        Bucket=f"ai-journal-artifacts-{account}",
        Key=key,
        Body=body.encode("utf-8"),
        ContentType="application/jsonl",
    )
    return f"s3://ai-journal-artifacts-{account}/{key}"


def _output_uri(account, name):
    return f"s3://ai-journal-artifacts-{account}/eval/faithfulness/output/{name}/"


def _role_arn(account):
    return f"arn:aws:iam::{account}:role/ai-journal-faithfulness"


def _start_job(session, request):
    response = session.client("bedrock").create_evaluation_job(**_boto(request))
    return response["jobArn"]


def _boto(value):
    if isinstance(value, list):
        return [_boto(item) for item in value]
    if isinstance(value, dict):
        return {_snake(key): _boto(item) for key, item in value.items()}
    return value


def _snake(key):
    chars = []
    for char in key:
        if char.isupper():
            chars.append("_")
            chars.append(char.lower())
        else:
            chars.append(char)
    return "".join(chars)


def _finished_scores(session, job_arn):
    job = _wait(session.client("bedrock"), job_arn)
    if job["status"] != "Completed":
        messages = job.get("failureMessages") or ["the job failed"]
        raise SystemExit("; ".join(messages))
    return _scores_at(session.client("s3"), job["outputDataConfig"]["s3Uri"])


def _wait(bedrock, job_arn):
    for _ in range(80):
        job = bedrock.get_evaluation_job(jobIdentifier=job_arn)
        print(job["status"], flush=True)
        if job["status"] in {"Completed", "Failed", "Stopped"}:
            return job
        time.sleep(30)
    raise SystemExit("the job is still running")


def _scores_at(s3, uri):
    bucket, prefix = _bucket_and_key(uri)
    found = []
    pages = s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix)
    for page in pages:
        for item in page.get("Contents", []):
            if not item["Key"].endswith(".jsonl"):
                continue
            body = s3.get_object(Bucket=bucket, Key=item["Key"])["Body"].read().decode("utf-8")
            found.extend(scores_from_body(body))
    return found


def _bucket_and_key(uri):
    bucket, _, key = uri.removeprefix("s3://").partition("/")
    return bucket, key


def _print_score(row):
    print(f"{row['score']}\t{row['explanation']}", flush=True)


if __name__ == "__main__":
    main(sys.argv)
