from src.celery_app import celery_app
from src.llm_guard import get_allowed_model_provider


@celery_app.task(bind=True, name="run_agent_turn")
def run_agent_turn(
    self,
    review_id: str,
    turn_id: str,
    role_version_id: str,
    objective: str,
    document_summary: str,
    retrieved_chunks: list[dict],
    tenant_id: str = "default",
    is_desensitized_sample: bool = False
):
    """Execute one Agent turn — retrieve context, call LLM, validate output."""
    provider = get_allowed_model_provider(tenant_id, is_desensitized_sample)
    
    # TODO: Sprint 0.5 — implement with LLM + RAG
    return {
        "turn_id": turn_id,
        "provider": provider,
        "status": "completed",
        "opinions": [],
    }
