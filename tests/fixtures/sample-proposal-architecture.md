# PrismReview RAG Spike — Technical Test Document (Sample)

## Architecture Proposal: Event-Driven Microservice Migration

### 1. Background

The current monolith application is experiencing scalability limitations as user concurrency grows beyond 10,000 DAU. The proposed solution migrates core business logic to an event-driven microservice architecture.

### 2. Proposed Architecture

#### 2.1 Service Decomposition

- **API Gateway**: Route requests, rate limit, authenticate
- **User Service**: Registration, profile, preferences
- **Order Service**: Order creation, lifecycle, history
- **Payment Service**: Payment processing, refunds, reconciliation
- **Notification Service**: Email, SMS, push notification delivery
- **Analytics Service**: Event aggregation, reporting

#### 2.2 Event Bus

Apache Kafka will serve as the central event bus. Each service publishes domain events and subscribes to relevant events from other services.

```
[API Gateway]
    │
    ▼
[User]──►[Kafka]◄──[Order]
             │
    ┌────────┼────────┐
    ▼        ▼        ▼
[Payment] [Notify] [Analytics]
```

### 3. Key Design Decisions

1. **Saga Pattern for distributed transactions**: Order creation spans User (credit check), Payment (charge), and Notification (confirmation). Compensation events handle failures.
2. **CQRS for query-heavy services**: Analytics and reporting use read-optimized projections.
3. **Circuit Breaker for inter-service calls**: Payment service calls external PSP; circuit breaker prevents cascading failures.

### 4. Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Eventual consistency latency | Medium | Set SLA of 5s for order→notification |
| Kafka operational complexity | High | Use managed Kafka (Confluent/MSK) |
| Debugging distributed flows | Medium | Adopt OpenTelemetry + distributed tracing |
| Data loss on service crash | High | Idempotent consumers + outbox pattern |

### 5. Migration Strategy

Phase 1: Extract Notification Service (low risk, async by nature)
Phase 2: Extract Payment Service (high risk, feature-flag + shadow traffic)
Phase 3: Extract Order Service (core domain, gradual rollout)

### 6. Infrastructure Requirements

- Kubernetes cluster (minimum 3 nodes)
- Kafka cluster (minimum 3 brokers)
- PostgreSQL (managed, with read replicas)
- Redis cache cluster
- Service mesh (Istio or Linkerd)
