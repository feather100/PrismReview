import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { RolesModule } from './modules/roles/roles.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RolesModule,
    ReviewsModule,
    KnowledgeModule,
    AuditModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // 守卫按 providers 数组顺序执行：先 JwtAuthGuard 注入用户，再 PermissionsGuard 校验权限
    JwtAuthGuard,
    PermissionsGuard,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    // 全局审计拦截器（仅写操作留痕）
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
