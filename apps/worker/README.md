# PrismReview Worker (status: dormant scaffold)

> ⚠️ **This directory is a scaffold reserved for the P6 (规模化) milestone. It is NOT wired into the running system today.**

## What this is

A Celery (Python) worker skeleton intended to eventually run resource-intensive
background jobs **out-of-process** from the NestJS API:

| Job | Purpose | Status |
|-----|---------|--------|
| `parse_document` | Extract text/structure from uploaded PDF/Word | TODO stub |
| `embed_document` | Generate chunk embeddings (requires pgvector) | TODO stub |
| `diagnose_review` | Backfill diagnosis from a dedicated model call | TODO stub |
| `run_agent_turn` | Run one reviewer turn in a separate process | TODO stub |
| `summarize_report` | Narrate/condense a full report | TODO stub |
| `export_report` | Build the final Markdown/PDF artifact | TODO stub |

All current orchestration runs **in-process inside `apps/api`**
(`modules/reviews/queue/queue.service.ts`). The Python/Celery layer has **no
broker connection, no running worker, and every job body is a TODO stub**.

## Why it exists

The NestJS-side `QueueService` deliberately exposes the `enqueue/completionHook`
shape that a real message broker (Redis/BullMQ or Celery) can slot into, so that
we can lift turn execution into isolated worker processes **when we scale to
multi-review parallel execution** — without rewriting the orchestration
contract (Contract §6 "编排脊柱").

When P6 kicks off, the wiring order is:

1. Stand up the Celery broker (Redis, already in `docker-compose.yml`).
2. Implement one job (recommended: `run_agent_turn`) end-to-end.
3. Replace the in-memory `QueueService.enqueue()` dispatcher with a
   broker-backed call while keeping the existing `completionHook` contract.
4. Only then mark this README's status as "active".

## What to do today

**Run demos & develop features: ignore this folder.** Everything happens in
`apps/api` + `apps/web`.

**Run the unit test (optional):**

```bash
cd apps/worker
python -m unittest tests/test_llm_guard.py
# or, with pytest installed:
# pytest tests/
```

### Implementation notes

- `celery_app.py` registers canonical names `worker.jobs.*` because it runs as a
  top-level package inside a Celery worker process. Local one-off scripts in
  `src/jobs/` use a relative `from src.celery_app import celery_app` because they
  sit under `src/`. When P6 wires this up, reconcile under a single root.
- All external calls are gated by `llm_guard.get_allowed_model_provider(...)`,
  which enforces `ALLOW_EXTERNAL_MODEL_CALLS=true` + tenant scoping + real-doc
  desensitization — the same invariant the TS provider-factory enforces.
