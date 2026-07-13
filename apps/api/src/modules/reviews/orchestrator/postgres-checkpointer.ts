/**
 * postgres-checkpointer.ts — Postgres 后端 Checkpointer（Contract §2.3 / §6）
 *
 * save：sequence = max+1（单调递增，resume 取最大）。
 * load：取 sequence 最大者 → ReviewState（崩溃后从 currentNodeId resume）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Checkpoint, Checkpointer, ReviewState } from './graph-runtime';

@Injectable()
export class PostgresCheckpointer implements Checkpointer {
  private readonly logger = new Logger(PostgresCheckpointer.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(reviewId: string, nodeId: string, state: ReviewState): Promise<Checkpoint> {
    const agg = await this.prisma.reviewCheckpoint.aggregate({
      where: { reviewId },
      _max: { sequence: true },
    });
    const nextSeq = (agg._max.sequence ?? 0) + 1;

    const record = await this.prisma.reviewCheckpoint.create({
      data: {
        reviewId,
        nodeId,
        stateJson: JSON.stringify(state),
        sequence: nextSeq,
      },
    });

    this.logger.log(
      `Checkpoint saved: review=${reviewId.substring(0, 8)} node=${nodeId} seq=${nextSeq}`,
    );

    return {
      id: record.id,
      reviewId: record.reviewId,
      nodeId: record.nodeId,
      stateJson: record.stateJson,
      sequence: record.sequence,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async load(reviewId: string): Promise<{ nodeId: string; state: ReviewState } | null> {
    const record = await this.prisma.reviewCheckpoint.findFirst({
      where: { reviewId },
      orderBy: { sequence: 'desc' },
    });
    if (!record) return null;
    try {
      const state = JSON.parse(record.stateJson) as ReviewState;
      return { nodeId: record.nodeId, state };
    } catch {
      this.logger.warn(`Checkpoint load parse failed: review=${reviewId.substring(0, 8)}`);
      return null;
    }
  }
}
