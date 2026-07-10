from worker.celery_app import celery_app


@celery_app.task(bind=True, name="export_report")
def export_report(self, report_id: str, format: str):
    """Export report to HTML/MD format."""
    # TODO: Sprint 0.5 — implement with template rendering
    return {"report_id": report_id, "format": format, "uri": ""}
