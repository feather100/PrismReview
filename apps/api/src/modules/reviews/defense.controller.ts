import { Controller, Get, Post, Patch, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReviewOrchestrator } from './orchestrator/review-orchestrator';
import { QueueService } from './queue/queue.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { WorkflowRegistry } from '../workflow/workflow.registry';
import { resolveHardGates } from './orchestrator/hard-gates';

/**
 * @Controller dédié à la boucle de défense (@专家 + 申辩).
 *
 * Séparé du ReviewsController principal pour éviter un bug de réflexion
 * NestJS qui faisait hériter à tort des décorateurs @RequirePermissions
 * entre routes d'un même contrôleur.
 */

interface DefenseStateResponse {
  reviewId: string;
  status: string;
  round: number;
  defenseCount: number;
  mentionExpertCode?: string;
  mentionDirection?: string;
  lastDecision?: any;
  awaitingUserDefense: boolean;
  totalTurns: number;
  completedTurns: number;
}

@Controller('reviews-defense')
export class DefenseController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: ReviewOrchestrator,
    private readonly queue: QueueService,
    private readonly workflowRegistry: WorkflowRegistry,
  ) {}

  /** Ping — test if controller is registered. */
  @Get('ping')
  ping() {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  /** État courant + défense loop. */
  @Get(':reviewId/state')
  async getState(
    @CurrentUser() _user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
  ): Promise<DefenseStateResponse> {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) return { reviewId, status: 'unknown', round: 0, defenseCount: 0, awaitingUserDefense: false, totalTurns: 0, completedTurns: 0 };
    const lastDecision = await this.prisma.moderatorDecision.findFirst({
      where: { reviewId }, orderBy: { createdAt: 'desc' },
      select: { decisionType: true, reasoning: true, round: true },
    });
    // Calculer la progression de tour (problème 3 + 4)
    const totalTurns = await this.prisma.reviewTurn.count({ where: { reviewId } });
    const completedTurns = await this.prisma.reviewTurn.count({ where: { reviewId, status: { in: ['completed', 'failed', 'timeout'] } } });
    return {
      reviewId: r.id,
      status: r.status,
      round: r.currentRound,
      defenseCount: r.defenseCount ?? 0,
      mentionExpertCode: r.mentionExpertCode ?? undefined,
      mentionDirection: r.mentionDirection ?? undefined,
      lastDecision,
      awaitingUserDefense: r.status === 'summarized' && lastDecision?.decisionType === 'ask_user_defense',
      totalTurns: totalTurns ?? 0,
      completedTurns: completedTurns ?? 0,
    };
  }

  /** @专家 — enregistre l'expert mentionné + la direction (phase diagnostic). */
  @Patch(':reviewId/mention')
  async setMention(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
    @Body() dto: { expertCode: string; direction?: string },
  ) {
    await this.assertOwned(reviewId, user);
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { mentionExpertCode: dto.expertCode, mentionDirection: dto.direction ?? null },
      select: { id: true, mentionExpertCode: true, mentionDirection: true },
    });
  }

  /** Soumettre une défense / complément d'informations → déclenche un nouveau round. */
  @Post(':reviewId/defense')
  async submitDefense(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
    @Body() dto: { content: string; targetExpert?: string },
  ) {
    const review = await this.assertOwned(reviewId, user);
    if (!dto.content?.trim()) throw new Error('Defense content required');

    // 1) Mettre à jour défense count + status + round + stocker dans last_defense (JSON)
    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        lastDefense: JSON.stringify({ content: dto.content, targetExpert: dto.targetExpert ?? null, round: review.currentRound, at: new Date().toISOString() }),
        defenseCount: (review.defenseCount ?? 0) + 1,
        status: 'running',
        currentNodeId: 'running',
        currentRound: (review.currentRound ?? 1) + 1,
      },
    });

    // 3) Déclencher le nouveau round via l'orchestrateur
    await this.orchestrator.startDefenseRound(reviewId, dto.content, dto.targetExpert);

    return { reviewId, status: updated.status, round: updated.currentRound, defenseCount: updated.defenseCount };
  }

  private async assertOwned(reviewId: string, user: { tenantId: string; id?: string }) {
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, tenantId: user.tenantId } });
    if (!review) throw new Error('Review not found or not owned');
    return review;
  }
}
