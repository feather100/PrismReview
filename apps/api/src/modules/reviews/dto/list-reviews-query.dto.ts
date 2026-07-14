import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListReviewsQuery {
  /**
   * Comma-separated list of statuses to filter by, e.g. "completed,failed".
   * Maps to `WHERE status IN (...)`.
   */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  mode?: string;

  /**
   * Free-text search across `title` and `objective` (case-insensitive / ILIKE).
   */
  @IsOptional()
  @IsString()
  search?: string;

  /** 1-based page number (default 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 20;

  /**
   * Backward-compatible row offset. When omitted it is derived from `page`
   * (offset = (page - 1) * limit) so old clients keep working.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}
