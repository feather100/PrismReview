"""PrismReview Worker — Document & Agent Task Processing."""

from celery import Celery

celery_app = Celery(
    "prismreview_worker",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
    include=[
        "worker.jobs.parse_document",
        "worker.jobs.embed_document",
        "worker.jobs.diagnose_review",
        "worker.jobs.run_agent_turn",
        "worker.jobs.summarize_report",
        "worker.jobs.export_report",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,
    task_soft_time_limit=240,
)
