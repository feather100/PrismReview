import { Controller, Get, Post, Patch, Body, Param, Query, Sse, Res, UseInterceptors, ClassSerializerInterceptor, ParseUUIDPipe } from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { ReviewsService } from './reviews.service';
import { ReviewsGateway } from './reviews.gateway';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { SaveRoleSelectionDto } from './dto/save-role-selection.dto';
import { ListReviewsQuery } from './dto/list-reviews-query.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { HumanTurnDto } from './dto/human-turn.dto';

@Controller('reviews')
// 鉴权由全局 JwtAuthGuard 提供；除 POST /reviews 外，其余路由 RBAC 标注留待 ACTIVE_SPRINT P2 backlog
// TODO: RBAC pending (ACTIVE_SPRINT P2 backlog)
@UseInterceptors(ClassSerializerInterceptor)
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly reviewsGateway: ReviewsGateway,
  ) {}

  @Post()
  @RequirePermissions('review.create')
  async createReview(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.createReview(dto, user);
  }

  @Get()
  async listReviews(
    @CurrentUser() user: AuthUser,
    @Query() query: ListReviewsQuery,
  ) {
    return this.reviewsService.listReviews(user, query);
  }

  @Patch(':reviewId/archive')
  async archive(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.archiveReview(reviewId, user);
  }

  @Patch(':reviewId/unarchive')
  async unarchive(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.unarchiveReview(reviewId, user);
  }

  @Get(':reviewId')
  async getReview(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.getReview(reviewId, user);
  }

  @Post(':reviewId/diagnose')
  async diagnose(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<any> {
    return this.reviewsService.diagnose(reviewId, user);
  }

  @Get(':reviewId/diagnosis')
  async getDiagnosis(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<any> {
    return this.reviewsService.getDiagnosis(reviewId, user);
  }

  @Post(':reviewId/roles')
  async saveRoles(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
    @Body() dto: SaveRoleSelectionDto,
  ): Promise<any> {
    return this.reviewsService.saveRoleSelection(reviewId, user, dto);
  }

  @Post(':reviewId/start')
  async startReview(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<any> {
    return this.reviewsService.startReview(reviewId, user);
  }

  @Post(':reviewId/interrupt')
  async interrupt(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<any> {
    return this.reviewsService.interrupt(reviewId, user);
  }

  @Post(':reviewId/resume')
  async resume(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<any> {
    return this.reviewsService.resume(reviewId, user);
  }

  /**
   * P4 Human Turn Override（Sprint 5.2 §3.4）：人类评审员手动注入意见（source='human'）。
   * 需 review.write 权限（T22：无权限 → 403）。
   */
  @Post(':reviewId/meetings')
  @RequirePermissions('review.write')
  async submitHumanTurn(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
    @Body() dto: HumanTurnDto,
  ): Promise<any> {
    return this.reviewsService.submitHumanTurn(reviewId, user, dto);
  }

  /** P4（Sprint 5.2 T21）：返回某评审的工具调用审批日志（ToolCallRequest）。需 review.read 权限。 */
  @Get(':reviewId/tool-requests')
  @RequirePermissions('review.read')
  async getToolRequests(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<any> {
    return this.reviewsService.getToolRequests(reviewId, user);
  }

  @Sse(':reviewId/meeting/stream')
  async meetingStream(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<Observable<MessageEvent>> {
    const result = await this.reviewsService.validateMeetingStream(reviewId, user) as any;
    if (result.dbTurns) {
      return this.reviewsGateway.getMeetingStreamFromDb(reviewId, result.sessionId, result.dbTurns, result.reviewStatus, result.expectedTurnCount);
    }
    return this.reviewsGateway.getMeetingStream(reviewId, result.sessionId, result.roles);
  }

  @Sse(':reviewId/diagnose/stream')
  async diagnoseStream(
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<Observable<MessageEvent>> {
    return this.reviewsGateway.getDiagnoseStream(reviewId);
  }

  @Post(':reviewId/summarize')
  async summarize(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<any> {
    return this.reviewsService.summarize(reviewId, user);
  }

  @Get(':reviewId/report')
  async getReport(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<ReportResponseDto> {
    return this.reviewsService.getReport(reviewId, user);
  }

  @Get(':reviewId/report/export.md')
  async exportMarkdown(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
    @Res() res: Response,
  ) {
    const md = await this.reviewsService.exportMarkdown(reviewId, user);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prismreview-' + reviewId.substring(0, 8) + '.md"');
    res.send(md);
  }
}

