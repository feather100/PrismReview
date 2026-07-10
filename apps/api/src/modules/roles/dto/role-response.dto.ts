import { Expose, Type } from 'class-transformer';

class ActiveVersionBriefDto {
  @Expose() id: string;
  @Expose() version: number;
  @Expose() dimensions: string[];
}

export class RoleBriefDto {
  @Expose() id: string;
  @Expose() code: string;
  @Expose() name: string;
  @Expose() type: string;
  @Expose() status: string;
  @Expose() @Type(() => ActiveVersionBriefDto) activeVersion?: ActiveVersionBriefDto;
  @Expose() createdAt: string;
}

class VersionBriefDto {
  @Expose() id: string;
  @Expose() version: number;
  @Expose() dimensions: string[];
  @Expose() createdAt: string;
}

export class RoleDetailDto extends RoleBriefDto {
  @Expose() departmentId?: string;
  @Expose() @Type(() => VersionBriefDto) versions?: VersionBriefDto[];
}

export class RoleWithDetailsDto {
  @Expose() id: string;
  @Expose() roleId: string;
  @Expose() roleCode: string;
  @Expose() roleName: string;
  @Expose() weight: number;
  @Expose() reason?: string;
  @Expose() removable: boolean;
}
