import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * 全局审计拦截器（Sprint 5.0）。
 *
 * 仅对写操作（POST/PUT/PATCH/DELETE）留痕；读请求与 /audit 自身端点跳过（防死循环）。
 * 审计写入失败以 .catch 兜底，绝不阻塞主流程（红线 #8）。
 * 业务处理报错时（如 400 校验失败）不写审计，原样重抛原始错误。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  private readonly MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req: any = context.switchToHttp().getRequest();
    const method = (req.method || 'GET').toUpperCase();

    // 读请求 + 审计自身端点（含 /audit）→ 跳过，不审计、防死循环。
    // 同时检查 req.path（含全局前缀 /api）与 req.route.path（路由相对），避免前缀误判。
    const rawPath = req.path || '';
    const routePath = req.route && req.route.path ? req.route.path : '';
    if (!this.MUTATING.includes(method) || rawPath.includes('/audit') || routePath.includes('/audit')) {
      return next.handle();
    }

    // 关键：req.path 与 req.route.path 都含全局前缀 /api（NestJS 注册路由时自带前缀），
    // 不能直接取首段，否则 segments[0]='api' → action 写成 api.created 而非 review.created（红线场景）。
    // 去掉全局前缀段后再解析业务资源。
    const path: string = (routePath || rawPath || '').replace(/^\/api(\/|$)/i, '/');
    const segments = path.split('/').filter(Boolean); // 例如 ['reviews', ':id', 'archive']
    const first = segments[0] || '';

    return next.handle().pipe(
      tap((body) => this.record(method, req, body, first, segments)),
      // 业务错误不审计，原样重抛（不阻塞主流程）
      catchError((err) => throwError(() => err)),
    );
  }

  private resourceFrom(first: string): string {
    switch (first) {
      case 'reviews': return 'review';
      case 'roles': return 'role';
      case 'users': return 'user';
      case 'quality': return 'quality';
      default: return first;
    }
  }

  private verbFrom(method: string): string {
    switch (method) {
      case 'POST': return 'created';
      case 'PATCH': return 'updated';
      case 'PUT': return 'updated';
      case 'DELETE': return 'deleted';
      default: return 'unknown';
    }
  }

  private resolveResourceId(req: any): string | null {
    if (req.params?.id) return req.params.id;
    if (req.params?.reviewId) return req.params.reviewId;
    if (req.params?.roleId) return req.params.roleId;
    return null;
  }

  private buildAction(method: string, first: string, segments: string[], req: any): string {
    // POST /reviews → review.created
    if (first === 'reviews' && method === 'POST' && segments.length === 1) {
      return 'review.created';
    }
    // P4 (Sprint 5.2 T20)：POST /reviews/:id/meetings → review.human_turn
    if (first === 'reviews' && method === 'POST' && segments.includes('meetings')) {
      return 'review.human_turn';
    }
    // PATCH /reviews/:id/archive → review.archived
    if (first === 'reviews' && method === 'PATCH' && segments.includes('archive')) {
      return 'review.archived';
    }
    // PATCH /users/:id → 改 platformRole 记 user.role_changed，否则 user.updated
    if (first === 'users' && method === 'PATCH') {
      const keys = req.body ? Object.keys(req.body) : [];
      return keys.includes('platformRole') ? 'user.role_changed' : 'user.updated';
    }
    return `${this.resourceFrom(first)}.${this.verbFrom(method)}`;
  }

  private buildDetail(method: string, first: string, segments: string[], req: any, body: any): any {
    // 不记 body 全文、不记密码/Token（红线 #7）
    if (first === 'reviews' && method === 'POST' && segments.length === 1) {
      const b = req.body || {};
      return { title: b.title ?? null, mode: b.mode ?? null, inputType: b.inputType ?? null };
    }
    if (first === 'reviews' && method === 'PATCH' && segments.includes('archive')) {
      const b = req.body || {};
      return { reviewId: req.params?.reviewId ?? null, fromStatus: b.fromStatus ?? (body && body.status) ?? null };
    }
    if (first === 'users' && method === 'PATCH') {
      const keys = req.body ? Object.keys(req.body) : [];
      return { updatedFields: keys };
    }
    return { method, path: req.path };
  }

  private record(method: string, req: any, body: any, first: string, segments: string[]) {
    try {
      const user: AuthUser | undefined = req.user;
      const tenantId = user?.tenantId ?? '00000000-0000-0000-0000-000000000001';
      const userId = user?.id ?? null;

      const action = this.buildAction(method, first, segments, req);
      const detail = this.buildDetail(method, first, segments, req, body);
      const resourceId = this.resolveResourceId(req);

      this.auditService
        .log({
          tenantId,
          userId,
          action,
          resource: this.resourceFrom(first),
          resourceId: resourceId ?? null,
          detail,
          ipAddress: req.ip ?? null,
          userAgent: req.headers ? req.headers['user-agent'] ?? null : null,
        })
        .catch(() => {
          /* 审计失败不阻塞主流程 */
        });
    } catch {
      /* 记录过程异常不阻塞主流程 */
    }
  }
}
