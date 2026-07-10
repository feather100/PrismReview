import { Controller, Get, Post, Patch, Param, Body, Query, ParseUUIDPipe, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SearchTestDto } from './dto/search-test.dto';

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('documents')
  async listDocuments(@CurrentUser() user: AuthUser) {
    return this.knowledgeService.listDocuments(user.tenantId);
  }

  @Post('documents')
  async uploadDocument(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.knowledgeService.uploadDocument(user.tenantId, body);
  }

  @Get('documents/:documentId')
  async getDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
  ) {
    return this.knowledgeService.getDocument(user.tenantId, documentId);
  }

  @Get('documents/:documentId/chunks')
  async listChunks(
    @CurrentUser() user: AuthUser,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
  ) {
    return this.knowledgeService.listChunks(user.tenantId, documentId);
  }

  @Patch('chunks/:chunkId/review-status')
  async updateChunkReview(
    @CurrentUser() user: AuthUser,
    @Param('chunkId', new ParseUUIDPipe({ version: '4' })) chunkId: string,
    @Body('reviewStatus') reviewStatus: string,
  ) {
    return this.knowledgeService.updateChunkReview(user.tenantId, chunkId, reviewStatus);
  }

  @Post('search-test')
  async searchTest(
    @CurrentUser() user: AuthUser,
    @Body() dto: SearchTestDto,
  ) {
    return this.knowledgeService.searchTest(user.tenantId, dto);
  }

  @Post('documents/:documentId/reindex')
  async reindex(
    @CurrentUser() user: AuthUser,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
  ) {
    return this.knowledgeService.reindex(user.tenantId, documentId);
  }
}
