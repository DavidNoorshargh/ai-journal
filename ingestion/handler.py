import os


def start_ingestion(client, knowledge_base_id, data_source_id):
    """Start one ingestion job. A job that is already running is success."""
    try:
        client.start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
        )
    except client.exceptions.ConflictException:
        return False
    return True


def handler(event, context, client=None):
    records = event.get("Records") or []
    if not records:
        return {"started": False}

    if client is None:
        import boto3

        client = boto3.client("bedrock-agent")

    started = start_ingestion(
        client,
        os.environ["KNOWLEDGE_BASE_ID"],
        os.environ["DATA_SOURCE_ID"],
    )
    return {"started": started}
