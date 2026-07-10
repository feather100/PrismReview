from src.celery_app import celery_app
from src.llm_guard import get_allowed_model_provider


@celery_app.task(bind=True, name="embed_document")
def embed_document(self, document_id: str, chunk_ids: list[str], tenant_id: str = "default", is_desensitized_sample: bool = False):
    """Generate embeddings for document chunks and store in pgvector."""
    provider = get_allowed_model_provider(tenant_id, is_desensitized_sample)
    
    # TODO: Sprint 0.5 — implement with OpenAI/text-embedding-3-small
    return {"document_id": document_id, "provider": provider, "chunks_indexed": 0}
