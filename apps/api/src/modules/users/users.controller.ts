import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

/**
 * 用户管理 API（Sprint 5.0）。全部端点受 RBAC 保护（语义见 §2.4）。
 * 鉴权由全局 JwtAuthGuard 提供，此处不重复 @UseGuards。
 */
@Controller('users')
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('role.read')
  listUsers(@CurrentUser() user: AuthUser, @Query() query: ListUsersQueryDto) {
    return this.usersService.listUsers(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('role.read')
  getUser(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.usersService.getUser(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('role.write')
  createUser(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.usersService.createUser(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('role.write')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('role.delete')
  deleteUser(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.usersService.deleteUser(user.tenantId, id);
  }
}
