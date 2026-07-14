/**
 * quality.controller.ts — REST endpoints for provider quality evaluation (Sprint 4.0)
 *
 * All endpoints are under JwtAuthGuard + tenant isolation (enforced in service).
 * Route prefix is `/api/quality/...` (global prefix `api` set in main.ts).
 *
 * Endpoints:
 *   POST   /api/quality/evaluate/:reviewId  — evaluate a single review
 *   POST   /api/quality/batch               — run batch evaluation
 *   GET    /api/quality/reports             — list reports (paginated + filtered)
 *   GET    /api/quality/reports/:id         — get a single report
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../../../common/decorators/current-user.decorator';
import { QualityService } from './quality.service';

@Controller('quality')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  /**
   * POST /api/quality/evaluate/:reviewId
   * Body: { provider?: string }  — optional provider override for comparison
   */
  @Post('evaluate/:reviewId')
  async evaluateReview(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { provider?: string },
  ) {
    return this.qualityService.evaluateReview(reviewId, user, {
      provider: body?.provider,
    });
  }

  /**
   * POST /api/quality/batch
   * Body: { count: number, provider: string, template?: { title?, objective?, mode? } }
   */
  @Post('batch')
  async evaluateBatch(
    @CurrentUser() user: AuthUser,
    @Body() body: {
      count: number;
      provider: string;
      template?: { title?: string; objective?: string; mode?: string };
    },
  ) {
    return this.qualityService.evaluateBatch(body, user);
  }

  /**
   * GET /api/quality/reports?provider=lmstudio&runMode=batch&page=1&limit=20
   */
  @Get('reports')
  async listReports(
    @Query('provider') provider?: string,
    @Query('runMode') runMode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.qualityService.listQualityReports({
      provider,
      runMode,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * GET /api/quality/reports/:id
   */
  @Get('reports/:id')
  async getReport(@Param('id') id: string) {
    return this.qualityService.getQualityReport(id);
  }
}
