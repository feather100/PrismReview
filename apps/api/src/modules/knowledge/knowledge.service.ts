import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SearchTestDto } from './dto/search-test.dto';

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocuments(tenantId: string) {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return docs.map(d => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      sizeBytes: Number(d.sizeBytes),
      status: d.status,
      scope: d.scope,
      createdAt: d.createdAt.toISOString?.() ?? d.createdAt,
    }));
  }

  async uploadDocument(tenantId: string, body: any) {
    // Mock: accept filename and content from JSON body (no multipart for now)
    const filename = body.filename ?? 'mock-document.md';
    const mimeType = body.mimeType ?? 'text/markdown';

    // 1. Save to local mock storage
    const localDir = `./data/uploads/${tenantId}`;
    await fs.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, filename);
    await fs.writeFile(localPath, body.content ?? '# Mock Document\n\nSample content for testing.');

    // 2. Create document record
    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        tenantId,
        filename,
        mimeType,
        sizeBytes: BigInt((body.content ?? '').length),
        storageUri: localPath,
        status: 'parsing',
        scope: 'global',
      },
    });

    // 3. Mock parse → chunk → index (synchronous)
    const mockChunks = this.mockChunkContent(filename, body.content);

    await this.prisma.knowledgeChunk.createMany({
      data: mockChunks.map((content, i) => ({
        documentId: doc.id,
        tenantId,
        content,
        metadata: {
          chunkIndex: i,
          page: Math.floor(i / 3) + 1,
          heading: i === 0 ? '概述' : `章节 ${i + 1}`,
        },
        reviewStatus: 'pending_review',
      })),
    });

    // 4. Mark as ready
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: 'ready' },
    });

    return {
      id: updated.id,
      filename: updated.filename,
      mimeType: updated.mimeType,
      sizeBytes: Number(updated.sizeBytes),
      status: updated.status,
      chunkCount: mockChunks.length,
      createdAt: updated.createdAt.toISOString?.() ?? updated.createdAt,
    };
  }

  async getDocument(tenantId: string, documentId: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return {
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: Number(doc.sizeBytes),
      status: doc.status,
      scope: doc.scope,
      createdAt: doc.createdAt.toISOString?.() ?? doc.createdAt,
    };
  }

  async listChunks(tenantId: string, documentId: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });

    return chunks.map(c => ({
      id: c.id,
      documentId: c.documentId,
      content: c.content,
      metadata: c.metadata,
      reviewStatus: c.reviewStatus,
      createdAt: c.createdAt.toISOString?.() ?? c.createdAt,
    }));
  }

  async updateChunkReview(tenantId: string, chunkId: string, reviewStatus: string) {
    if (!['approved', 'rejected', 'deprecated'].includes(reviewStatus)) {
      throw new BadRequestException(`Invalid reviewStatus: ${reviewStatus}`);
    }

    const chunk = await this.prisma.knowledgeChunk.findFirst({
      where: { id: chunkId },
      include: { document: { select: { tenantId: true } } },
    });
    if (!chunk || chunk.document.tenantId !== tenantId) {
      throw new NotFoundException('Chunk not found');
    }

    return this.prisma.knowledgeChunk.update({
      where: { id: chunkId },
      data: { reviewStatus },
    });
  }

  async searchTest(tenantId: string, dto: SearchTestDto) {
    const topK = dto.topK ?? 5;

    // Mock: PostgreSQL LIKE (case-insensitive), no real embedding
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        tenantId,
        reviewStatus: { not: 'deprecated' },
        content: { contains: dto.query, mode: 'insensitive' },
      },
      take: topK,
      include: { document: { select: { filename: true } } },
    });

    return chunks.map((chunk, i) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      document: chunk.document.filename,
      content: chunk.content.substring(0, 200),
      score: Math.round((1 - i / Math.max(chunks.length, 1)) * 100),
      reviewStatus: chunk.reviewStatus,
    }));
  }

  async reindex(tenantId: string, documentId: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'indexing' },
    });

    // Mock: immediate reindex
    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'ready' },
    });

    return { status: 'ready' };
  }

  // ── Helpers ──

  private mockChunkContent(filename: string, existingContent?: string): string[] {
    if (existingContent && existingContent.length > 100) {
      // Split by double newlines into paragraphs
      const paragraphs = existingContent.split(/\n\n+/).filter(p => p.trim().length > 0);
      if (paragraphs.length >= 2) return paragraphs;
    }

    // Default mock chunks
    return [
      `# ${filename} — 概述\n\n这是 ${filename} 的摘要内容。系统自动提取的关键信息。`,
      `## 核心规范\n\n方案要求在架构设计中遵循高可用标准，确保 99.9% SLA。`,
      `## 安全要求\n\n所有数据传输需 TLS 1.3 加密，敏感字段列级加密。`,
      `## 部署约束\n\n生产环境使用 Kubernetes 集群，最低 3 节点。`,
    ];
  }
}
