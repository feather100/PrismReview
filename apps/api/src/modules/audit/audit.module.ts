import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService], // 供 AuditInterceptor 注入
})
export class AuditModule {}
