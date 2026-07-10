import { Controller, Get, Post, Body, Param, Query, Delete, ParseUUIDPipe, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleBriefDto, RoleDetailDto } from './dto/role-response.dto';

@Controller('roles')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async listRoles(
    @CurrentUser() user: AuthUser,
    @Query('excludeIds') excludeIds?: string,
    @Query('available_for_review') reviewId?: string,
  ): Promise<RoleBriefDto[]> {
    const excludeIdArray = excludeIds ? excludeIds.split(',') : undefined;
    return this.rolesService.listRoles(user.tenantId, { excludeIds: excludeIdArray, reviewId });
  }

  @Get(':roleId')
  async getRole(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
  ): Promise<RoleDetailDto> {
    return this.rolesService.getRole(user.tenantId, roleId);
  }

  @Post()
  async createRole(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRoleDto,
  ): Promise<RoleDetailDto> {
    return this.rolesService.createRole(user.tenantId, user.id, dto);
  }

  @Post(':roleId/versions')
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
    @Body() dto: any,
  ): Promise<RoleDetailDto> {
    return this.rolesService.createVersion(user.tenantId, roleId, user.id, dto);
  }

  @Post(':roleId/activate-version')
  async activateVersion(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
    @Body('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
  ): Promise<RoleDetailDto> {
    return this.rolesService.activateVersion(user.tenantId, roleId, versionId);
  }

  @Post(':roleId/disable')
  async disableRole(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
  ): Promise<void> {
    await this.rolesService.disableRole(user.tenantId, roleId);
  }

  @Delete(':roleId')
  async deleteRole(
    @CurrentUser() user: AuthUser,
    @Param('roleId', new ParseUUIDPipe({ version: '4' })) roleId: string,
  ): Promise<void> {
    await this.rolesService.deleteRole(user.tenantId, roleId);
  }
}
