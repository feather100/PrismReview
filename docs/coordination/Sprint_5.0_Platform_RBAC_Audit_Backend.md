# Sprint 5.0 — Platform RBAC Enforcement + User Management + Audit Logging

> **角色**：workbuddy-coder（标准 Gate）
> **模式**：标准 Guard（新增 guard / interceptor / 全局注册 / 新模块，语义变更）
> **架构权威**：`docs/roadmap/Sprint_9_Product_Roadmap_Reset.md`（§11 P6 含"多租户/权限/审计"）
> **基线**：main = `c247b1b`（Sprint 4.0 已入库）
> **日期**：2026-07-14
> **Owner**：workbuddy-coder
> **目的**：把已定义但未生效的 RBAC 权限映射表落地为可执行 guard；补 JwtAuthGuard 的 permissions 字段；新建 AuditService + AuditInterceptor 让所有写操作留痕；新建 Users 管理 API；reviews + roles 模块示范 RBAC 标注。

---

## 0. 开工三连查（强制 P0）

```bash
git rev-parse --show-toplevel   # 必须 = D:/workspace/PrismReview
git status --short              # 起点干净（ACTIVE_SPRINT.md 预存 M 可接受）
git remote -v                   # 必须指向 feather100/PrismReview
git pull --ff-only origin main  # 快进同步到最新 main = c247b1b
```

---

## 1. 现状与目标

### 1.1 已核实的代码事实

| 能力 | 现状 | 位置 |
|------|------|------|
| platformRole 枚举 | `super_admin` / `enterprise_admin` / `department_admin` / `user` | `schema.prisma:User.platformRole` |
| 权限映射表 | 已定义但**未使用** | `auth.service.ts` `ROLE_PERMISSIONS` |
| AuthUser 接口 | 含 `permissions: string[]`，但 **JwtAuthGuard 未填充** | `current-user.decorator.ts` vs `jwt-auth.guard.ts` |
| GET /auth/me | 调 `getPermissions(platformRole)` → 正常 | `auth.controller.ts` |
| roles 模块 | AgentRole CRUD 完整，**无 RBAC 保护** | `modules/roles/` |
| reviews / quality | 仅 JwtAuthGuard（mock），权限未分级 | controllers |
| AuditLog schema | 已定义，**全项目零写入** | `schema.prisma` |
| Tenant 隔离 | 业务层手撸 `where.tenantId`；TenantGuard 仅参数级 | `tenant.guard.ts` |
| users / departments API | **无**（schema 有，API 无） | — |

### 1.2 目标

1. **RBAC 基础设施**：`@RequirePermissions(...)` + `PermissionsGuard`
2. **JwtAuthGuard 补 permissions**：经 `AuthService.getPermissions()` 填充
3. **Audit 基础设施**：`AuditService` + `AuditInterceptor`（全局，仅 POST/PATCH/DELETE）
4. **Users 管理 API**：租户内 CRUD，受 RBAC 保护
5. **RBAC 示范**：reviews（1 处写操作）+ roles（全量）
6. **前端零改动**；默认 mock；不写密钥；不 `--force`

### 1.3 In / Out

**In（本次交付）**

- 新建 `common/decorators/permissions.decorator.ts`（`@RequirePermissions(...)`）
- 新建 `common/guards/permissions.guard.ts`
- 修改 `common/guards/jwt-auth.guard.ts`（注入 AuthService + 补 `permissions`）
- 新建 `common/interceptors/audit.interceptor.ts`
- 新建 `modules/audit/`（audit.service + audit.controller + audit.module + dto）
- 新建 `modules/users/`（users.service + users.controller + users.module + dto×4）
- 修改 `app.module.ts`（APP_GUARD 注册 JwtAuthGuard + PermissionsGuard；APP_INTERCEPTOR 注册 AuditInterceptor；imports 加 AuditModule + UsersModule）
- 修改 `reviews.controller.ts`（POST /reviews 加 `@RequirePermissions('review.create')`；其余路由留 `// TODO: RBAC pending`）
- 修改 `roles.controller.ts`（按 §2.5 权限矩阵全量标注）
- 新建 `scripts/verify-sprint-5-rbac-audit.js`（gitignored，≥20 场景）
- 滚动 `ACTIVE_SPRINT.md` 到 Sprint 5.0

**Out（不做）**

- 真 JWT 验证；前端 RBAC UI；邀请/密码重置/邮件
- 全局全量 RBAC 覆盖（仅 reviews + roles 示范）
- 审计保留策略、审计前端查看页
- 任何 schema 变更（零 migration）
- Department 独立 CRUD API（`departmentId` 仅字段接收 + 存在性校验）
- 不写密钥；不 `--force`；不 commit

---

## 2. 实现规格

### 2.1 Permissions 装饰器 + Guard

**`apps/api/src/common/decorators/permissions.decorator.ts`**

```ts
import { SetMetadata } from '@nestjs/common';
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

**`apps/api/src/common/guards/permissions.guard.ts`**

```ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY, [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true; // 未标注 → 不拦截
    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('AUTH_REQUIRED');
    const hold: string[] = Array.isArray(user.permissions) ? user.permissions : [];
    if (!required.some(p => hold.includes(p))) {
      throw new ForbiddenException(
        `PERMISSION_DENIED: requires one of [${required.join(', ')}]`,
      );
    }
    return true;
  }
}
```

**执行语义**：OR（至少满足一个）。未标 `@RequirePermissions` 的路由不拦截（仍由 JwtAuthGuard 前置保证登录）。

### 2.2 JwtAuthGuard 改造

**已知架构问题**：JwtAuthGuard 当前 `@Injectable()` 但未在任何 module providers；NestJS `@UseGuards` 传类仍可实例化，但**注入会失败**。

**解决方案**（最小震动）：

1. `app.module.ts` providers 加 `JwtAuthGuard, PermissionsGuard`
2. `app.module.ts` 加两条 `APP_GUARD`（按 providers 数组顺序执行）：
   ```ts
   { provide: APP_GUARD, useClass: JwtAuthGuard },
   { provide: APP_GUARD, useClass: PermissionsGuard },
   ```
3. 删除各 controller 上的 `@UseGuards(JwtAuthGuard)`（全局已覆盖），**保留** `@RequirePermissions(...)`

**JwtAuthGuard 改造后：**

```ts
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.user) {
      request.user = {
        id: '00000000-0000-0000-0000-000000000001',
        tenantId: '00000000-0000-0000-0000-000000000001',
        departmentId: null, name: 'Mock User',
        email: 'mock@prismreview.dev',
        platformRole: 'enterprise_admin',
        permissions: this.authService.getPermissions('enterprise_admin'), // ← 关键
      };
    } else if (!request.user.permissions) {
      request.user.permissions = this.authService.getPermissions(
        request.user.platformRole ?? 'user',
      );
    }
    return true;
  }
}
```

> 默认 mock 保持 `enterprise_admin`（当前值），smoke 不被新增 RBAC 拦截（仅 enterprise_admin 已有的权限才会被标注）。

### 2.3 AuditService + AuditInterceptor

**`modules/audit/audit.service.ts`**

```ts
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  async log(input: {
    tenantId: string; userId?: string | null;
    action: string; resource: string; resourceId?: string | null;
    detail?: any; ipAddress?: string | null; userAgent?: string | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId, userId: input.userId ?? null,
        action: input.action, resource: input.resource,
        resourceId: input.resourceId ?? null,
        detail: input.detail ?? {},
        ipAddress: input.ipAddress ?? null, userAgent: input.userAgent ?? null,
      },
    }).catch((e) => { /* 审计不阻塞主流程 */ });
  }
}
```

**`common/interceptors/audit.interceptor.ts`**

```ts
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}
  private readonly MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = (req.method || 'GET').toUpperCase();
    if (!this.MUTATING.includes(method) || req.path?.includes('/audit')) {
      return next.handle(); // 读请求 + 审计自身端点 → 跳过
    }
    return next.handle().pipe(
      tap((body) => this.record(method, req, body)),
      catchError(() => { /* 业务错误不审计，直接重抛 */ throw new Error('audit-skip'); }),
    );
  }

  private record(method: string, req: any, body: any) {
    // 拼接后调 this.authService.log(...)
    // action = resource.verb：POST→created / PATCH→updated / DELETE→deleted
    // resource = 路径第一节（/reviews→review /roles→role /users→user /quality→quality.batch_run）
    // detail 见下方规则（不记 body 全文、不记密码/Token）
    // userId / tenantId 从 req.user 取
    // ipAddress = req.ip；userAgent = req.headers['user-agent']
  }
}
```

**detail 字段规则**（安全，不记敏感字段）：

| 场景 | action | detail |
|------|--------|--------|
| POST /reviews | `review.created` | `{ title, mode, inputType }` |
| PATCH /reviews/:id/archive | `review.archived` | `{ reviewId, fromStatus }` |
| PATCH /users/:id | `user.updated` | `{ updatedFields: ['platformRole','status'] }`（仅列变更 key 名） |
| 其他写操作 | `{resource}.{verb}` | `{ method, path }` |

**注册**：`app.module.ts`
```ts
{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
```

**审计读 API** `modules/audit/audit.controller.ts`：

```ts
@Controller('audit')
@RequirePermissions('audit.read')
export class AuditController {
  @Get('logs')
  async listLogs(@CurrentUser() user: AuthUser, @Query() q: ListAuditQueryDto) {
    // where: { tenantId: user.tenantId }（super_admin 例外可读所有）
    // 可选筛选：action / resource / userId；分页 page/limit；orderBy createdAt desc
    // 返回 { items, total, page, totalPages }
  }
}
```

**`modules/audit/audit.module.ts`**：controllers + providers AuditService + exports AuditService（供 AuditInterceptor 注入）。

**`modules/audit/dto/list-audit-query.dto.ts`**：`page?` `limit?` `action?` `resource?` `userId?`

### 2.4 Users 管理 API（新建模块）

**`modules/users/dto/`**

- `create-user.dto.ts`：`email` (必填，格式), `name` (必填), `platformRole` (必填枚举), `departmentId?` (可选)
- `update-user.dto.ts`：`name?`, `platformRole?`, `departmentId?`, `status?` (`active|disabled`)
- `list-users-query.dto.ts`：`page?` `limit?` `platformRole?` `status?` `search?` (name/email ILIKE)
- `user-response.dto.ts`：`id, tenantId, departmentId?, email, name, platformRole, status, createdAt`

**`modules/users/users.service.ts`**

- `listUsers(tenantId, query)` — `where: { tenantId }` + status/platformRole/search + 分页 → `{ items, total, page, totalPages }`
- `getUser(tenantId, userId)` — `{ id, tenantId }`查 → 404/返回
- `createUser(tenantId, dto)` — 同 tenant email 防重(findOne)；`passwordHash='mock_password_hash'`（占位）；`status='active'`；存在性校验 departmentId
- `updateUser(tenantId, userId, dto)` — 存在性 + 字段更新（"自救问题留真 auth 处理"注释）
- `deleteUser(tenantId, userId)` — 软删除 `status='disabled'`（物理行保留）

**`modules/users/users.controller.ts`**

```ts
@Controller('users')
export class UsersController {
  @Get()                          @RequirePermissions('role.read')     listUsers
  @Get(':id')                     @RequirePermissions('role.read')     getUser
  @Post()                         @RequirePermissions('role.write')    createUser
  @Patch(':id')                   @RequirePermissions('role.write')    updateUser
  @Delete(':id')                  @RequirePermissions('role.delete')   deleteUser
}
```

**`modules/users/users.module.ts`**：controllers + providers + exports UsersService。

### 2.5 现有 Controllers RBAC 标注

**reviews.controller.ts**（仅 1 处示范验证 + 其余留 TODO）

| 路由 | 注解 |
|------|------|
| POST /reviews | `@RequirePermissions('review.create')` |
| 所有其他路由 | 不加；注释 `// TODO: RBAC pending (ACTIVE_SPRINT P2 backlog)` |

> rationale：仅验证 guard + interceptor 协作（POST /reviews 写完自动写一条 `review.created` audit）。enterprise_admin 拥有所有 review.*，smoke 不破。

**roles.controller.ts**（全量标注）

| 路由 | 注解 |
|------|------|
| GET /roles, GET /roles/:id | `@RequirePermissions('role.read')` |
| POST /roles | `@RequirePermissions('role.write')` |
| POST /roles/:id/versions, /activate-version | `@RequirePermissions('role.write')` |
| POST /roles/:id/disable | `@RequirePermissions('role.write')` |
| DELETE /roles/:id | `@RequirePermissions('role.delete')` |

### 2.6 Prisma Schema — 不动

全部复用既有：`User / Department / AuditLog / Tenant`。User.email 无 tenant-scoped unique → createUser 在 service 层 findOne 防重。零 migration。

---

## 3. 红线（P0 必守）

| # | 红线 |
|---|------|
| 1 | 不动 `schema.prisma`、零 migration |
| 2 | 不改 `apps/web/` |
| 3 | 不写密钥；`passwordHash` 写 `'mock_password_hash'` 占位，**不引入 bcrypt** |
| 4 | 不提交 `.env` / `node_modules` / `data` / `.reasonix` / `.workbuddy` / 日志 |
| 5 | 不 `--force` push |
| 6 | 默认 mock `platformRole='enterprise_admin'`（不影响 smoke） |
| 7 | Audit detail 不记 body 全文、不记密码/Token |
| 8 | AuditInterceptor 写 AuditLog 必须 catch 兜底不阻塞主流程；`GET /audit/logs` 自身不被审计（防死循环） |
| 9 | `GET /audit/logs` 强制 tenant 隔离（super_admin 例外） |
| 10 | verify 脚本命名 `verify-sprint-5-*.js`（gitignore 通配符已覆盖） |
| 11 | 未 `git commit`/`push`/`--force` — 交 Codex 走标准 Guard |

---

## 4. 验收标准（Gate 证据，必须全绿）

### 4.1 静态门

- `tsc apps/api --noEmit` → **0 errors**
- `tsc apps/web --noEmit` → **0 errors**
- `prisma migrate status` → **up to date**（零迁移）
- 密钥扫描 `git grep -nE 'sk-…|AKIA|ghp_|xoxb|eyJhbGci' -- apps/api/src apps/web/src` → exit=1
- 入库清单 `git ls-files | grep -iE '\.env$|^node_modules|^data/|\.reasonix|\.workbuddy'` → 无输出

### 4.2 运行时 smoke

- `node scripts/smoke-runtime.js --base http://localhost:4000` → **31/31**
- `node apps/api/scripts/verify-sprint-5-rbac-audit.js` → **N/N**（目标 ≥ 20，见 §4.3）
- `node apps/api/scripts/verify-9.5b-multiround.js` → **22/22**（P1 回归）
- 既有 verify-review-history / verify-quality 等各自绿

### 4.3 verify-sprint-5 场景（最低 20 项）

| S# | 场景 | 期望 |
|----|------|------|
| T1 | enterprise_admin mock 持有 permissions 条数 ≥ 3 | PASS |
| T2 | enterprise_admin 调 POST /reviews（有 @RequirePermissions('review.create')） | 201 |
| T3 | enterprise_admin 调 GET /audit/logs（含 audit.read）→ 含 T2 的 audit 记录 `action='review.created'` | 200 |
| T4 | 创建 user（role.write 权限） | 201 |
| T5 | user 角色调 GET /roles/:id（role.read user 有） | 200 |
| T6 | user 角色调 POST /roles（role.write user **无**） | 403 PERMISSION_DENIED |
| T7 | user 角色调 DELETE /roles/:id（role.delete user 无） | 403 |
| T8 | 标注 @RequirePermissions 且 user.permissions 含该权限 → 放行 | 200 |
| T9 | PATCH /users/:id 改 platformRole → audit 写入 `user.role_changed`，`detail.updatedFields=['platformRole']` | PASS |
| T10 | GET /audit/logs 仅返回 caller.tenantId 记录（tenant 隔离） | PASS |
| T11 | AuditInterceptor 不审计 GET 请求（日志数前后不变） | PASS |
| T12 | users.list 默认 page=1 limit=20，totalPages 正确 | PASS |
| T13 | users.create 重复 email 同 tenant → 400 | PASS |
| T14 | users.create 未知 departmentId → 400 | PASS |
| T15 | users.delete 后 status='disabled'，物理行仍存（软删） | PASS |
| T16 | roles 全量 RBAC 标注后 enterprise_admin 可达所有端点 | PASS |
| T17 | POST /reviews 业务错时 interceptor 不写 audit（error path） | PASS |
| T18 | AuditService.log 主流程不因 audit 写失败而 block | PASS |
| T19 | createUser `passwordHash='mock_password_hash'`（不引入 bcrypt） | PASS |
| T20 | GET /audit/logs 路径不被 interceptor 自身审计（防死循环） | PASS |

---

## 5. 实施顺序建议

1. 改 `jwt-auth.guard.ts` + `app.module.ts` 注册 APP_GUARD → smoke 31/31
2. 新建 `permissions.decorator.ts` + `permissions.guard.ts`；POST /reviews 加 `@RequirePermissions` → smoke 31/31
3. 新建 `audit.interceptor.ts` + `audit.service.ts` + audit.controller + audit.module；APP_INTERCEPTOR → smoke 31/31
4. 新建 users 模块 + AppModule imports → smoke 31/31
5. reviews + roles 加 RBAC 标注 → smoke 31/31
6. 写 verify-sprint-5-rbac-audit.js（≥20）→ 跑通
7. 全部既有 verify 回归，tsc 双 0
8. 滚动 ACTIVE_SPRINT.md；git status 自检；回报 Codex，不 commit

---

## 6. 交付物清单

| 文件 | 类型 |
|------|------|
| `apps/api/src/common/decorators/permissions.decorator.ts` | 新建 |
| `apps/api/src/common/guards/permissions.guard.ts` | 新建 |
| `apps/api/src/common/interceptors/audit.interceptor.ts` | 新建 |
| `apps/api/src/common/guards/jwt-auth.guard.ts` | 修改 |
| `apps/api/src/modules/audit/audit.service.ts` | 新建 |
| `apps/api/src/modules/audit/audit.controller.ts` | 新建 |
| `apps/api/src/modules/audit/audit.module.ts` | 新建 |
| `apps/api/src/modules/audit/dto/list-audit-query.dto.ts` | 新建 |
| `apps/api/src/modules/users/users.service.ts` | 新建 |
| `apps/api/src/modules/users/users.controller.ts` | 新建 |
| `apps/api/src/modules/users/users.module.ts` | 新建 |
| `apps/api/src/modules/users/dto/create-user.dto.ts` | 新建 |
| `apps/api/src/modules/users/dto/update-user.dto.ts` | 新建 |
| `apps/api/src/modules/users/dto/list-users-query.dto.ts` | 新建 |
| `apps/api/src/modules/users/dto/user-response.dto.ts` | 新建 |
| `apps/api/src/modules/reviews/reviews.controller.ts` | 修改 |
| `apps/api/src/modules/roles/roles.controller.ts` | 修改 |
| `apps/api/src/app.module.ts` | 修改 |
| `apps/api/scripts/verify-sprint-5-rbac-audit.js` | 新建（gitignore） |
| `docs/coordination/ACTIVE_SPRINT.md` | 修改 |

纪律：不引入新 npm 包 / 不跑 model / 不伪造验证 / 不 commit/push/--force。

---

## 7. 给 Codex 回报模板

```
【Sprint 5.0 workbuddy-coder 交付报告】

## 三连查
- toplevel / remote / base: ✓

## 范围
- git status 改动文件列表

## P0 红线
- schema 未动 / web 未动 / 密钥零命中 / .env 等未入库 / 不 --force

## 验证
- tsc api=0 / tsc web=0
- migrate status=up to date
- smoke 31/31
- verify-sprint-5-rbac-audit.js N/N
- verify-9.5b-multiround 22/22
- 既有 verify 全绿
- git status 未提交

## 结论
建议标准 Guard 复审 / Go / No-Go
```

---

> 本 Sprint 未执行 `git commit`/`git push`。产出就绪后回报 Codex，由 Codex 走标准 Guard 复审再决定。
