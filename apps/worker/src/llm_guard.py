import os

class ModelGuardError(Exception):
    """Exception raised when an external model is called without proper permissions."""
    pass

def get_allowed_model_provider(tenant_id: str, is_desensitized_sample: bool = False) -> str:
    """
    Returns the allowed model provider based on strict cost and security gates.
    Defaults to 'mock'.
    """
    requested_provider = os.getenv("MODEL_PROVIDER", "mock").lower()

    if requested_provider == "mock":
        return "mock"

    allow_external = os.getenv("ALLOW_EXTERNAL_MODEL_CALLS", "false").lower() == "true"
    allow_real_docs = os.getenv("ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL", "false").lower() == "true"

    if not allow_external:
        raise ModelGuardError("External model calls are disabled by default. Set ALLOW_EXTERNAL_MODEL_CALLS=true.")

    if tenant_id != "test_tenant":
        raise ModelGuardError("External model calls are currently restricted to 'test_tenant' only.")

    if not is_desensitized_sample and not allow_real_docs:
        raise ModelGuardError("Cannot send real documents to external models without ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL=true.")

    return requested_provider
