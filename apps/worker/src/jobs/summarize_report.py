from worker.celery_app import celery_app


@celery_app.task(bind=True, name="summarize_report")
def summarize_report(self, review_id: str):
    """Chairman aggregation — merge opinions, deduplicate, generate report structure."""
    # TODO: Sprint 0.5 — implement with LLM + rules
    return {"review_id": review_id, "status": "summarized"}
