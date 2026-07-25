import { Body, Controller, Get, Post, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '@nca/shared';
import { z } from 'zod';
import { CurrentUser, Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import type { JwtPayload } from './auth.types';

const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});
type LoginDto = z.infer<typeof loginSchema>;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: '账号密码登录' })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() dto: LoginDto): Promise<{ token: string; user: CurrentUserType }> {
    const payload = await this.auth.validateUser(dto.username, dto.password);
    const token = await this.auth.issueToken(payload);
    const user = await this.auth.getProfile(payload.sub);
    return { token, user };
  }

  @Get('me')
  @ApiOperation({ summary: '获取当前登录用户与权限码' })
  async me(@CurrentUser() user: JwtPayload): Promise<CurrentUserType> {
    return this.auth.getProfile(user.sub);
  }
}
