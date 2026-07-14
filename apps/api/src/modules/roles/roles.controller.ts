import { Controller, Get, Post, Body, Param, Query, Delete, ParseUUIDPipe, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleBriefDto, RoleDetailDto } from './dto/role-response.dto';

@Controller('roles')
@UseInterceptors(ClassSerializerInterceptor)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('role.read')
  async listRoles(
    @CurrentUser() user: AuthUser,
    @Query('excludeIds') excludeIds?: string,
    @Query('available_for_review') reviewId?: string,
  ): Promise<RoleBriefDto[]> {
    const excludeIdArray = excludeIds ? excludeIds.split(',') : undefined;
    return this.rolesService.listRoles(user.tenantId, { excludeIds: excludeIdArray, reviewId });
  }

  @Get(':roleId')
  @RequirePermissions('role.read')
  async getRole(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
  ): Promise<RoleDetailDto> {
    return this.rolesService.getRole(user.tenantId, roleId);
  }

  @Post()
  @RequirePermissions('role.write')
  async createRole(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRoleDto,
  ): Promise<RoleDetailDto> {
    return this.rolesService.createRole(user.tenantId, user.id, dto);
  }

  @Post(':roleId/versions')
  @RequirePermissions('role.write')
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
    @Body() dto: any,
  ): Promise<RoleDetailDto> {
    return this.rolesService.createVersion(user.tenantId, roleId, user.id, dto);
  }

  @Post(':roleId/activate-version')
  @RequirePermissions('role.write')
  async activateVersion(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
    @Body('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
  ): Promise<RoleDetailDto> {
    return this.rolesService.activateVersion(user.tenantId, roleId, versionId);
  }

  @Post(':roleId/disable')
  @RequirePermissions('role.write')
  async disableRole(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
  ): Promise<void> {
    await this.rolesService.disableRole(user.tenantId, roleId);
  }

  @Delete(':roleId')
  @RequirePermissions('role.delete')
  async deleteRole(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
  ): Promise<void> {
    await this.rolesService.deleteRole(user.tenantId, roleId);
  }
}
