from src.celery_app import celery_app
from src.llm_guard import get_allowed_model_provider


@celery_app.task(bind=True, name="diagnose_review")
def diagnose_review(self, review_id: str, document_summary: str, objective: str, tenant_id: str = "default", is_desensitized_sample: bool = False):
    """Chairman pre-scan — generate diagnosis with tags, risk dimensions, recommended roles."""
    provider = get_allowed_model_provider(tenant_id, is_desensitized_sample)
    
    # TODO: Sprint 0.5 — implement with LLM call
    return {
        "review_id": review_id,
        "provider": provider,
        "tags": [],
        "risk_dimensions": [],
        "recommended_roles": [],
        "diagnosis_confidence": 0,
    }
