from worker.celery_app import celery_app


@celery_app.task(bind=True, name="parse_document")
def parse_document(self, document_id: str, storage_uri: str, mime_type: str):
    """Parse uploaded document — extract text and structure."""
    # TODO: Sprint 0.5 — implement with unstructured[pdf]
    return {"document_id": document_id, "status": "parsed", "chunk_count": 0}
