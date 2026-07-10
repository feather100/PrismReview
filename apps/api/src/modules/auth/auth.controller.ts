import { Controller, Get, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AuthUserResponseDto } from './dto/auth-user-response.dto';

@Controller('auth')
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthUser): AuthUserResponseDto {
    const dto = new AuthUserResponseDto();
    dto.id = user.id;
    dto.name = user.name;
    dto.email = user.email;
    dto.tenantId = user.tenantId;
    dto.departmentId = user.departmentId ?? undefined;
    dto.platformRole = user.platformRole;
    dto.permissions = this.authService.getPermissions(user.platformRole);
    return dto;
  }
}
