# PrismReview Worker

This module handles background jobs (Celery) for PrismReview, including document parsing, embedding generation, and AI agent orchestration.

## Testing

To run the unit tests locally (e.g., verifying the LLM guard restrictions), use the following commands from the `apps/worker` directory:

### Using Python's built-in unittest

```bash
# Ensure you are in the worker directory
cd apps/worker

# Run the test
python -m unittest tests/test_llm_guard.py
```

### Using pytest (if installed)

```bash
# Ensure you are in the worker directory
cd apps/worker

# Run all tests
pytest tests/
```
