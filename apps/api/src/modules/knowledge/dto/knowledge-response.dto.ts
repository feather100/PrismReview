import { Expose } from 'class-transformer';

export class DocumentResponseDto {
  @Expose() id: string;
  @Expose() filename: string;
  @Expose() mimeType: string;
  @Expose() sizeBytes: number;
  @Expose() status: string;
  @Expose() scope: string;
  @Expose() createdAt: string;
}

export class ChunkResponseDto {
  @Expose() id: string;
  @Expose() documentId: string;
  @Expose() content: string;
  @Expose() metadata: any;
  @Expose() reviewStatus: string;
  @Expose() createdAt: string;
}
