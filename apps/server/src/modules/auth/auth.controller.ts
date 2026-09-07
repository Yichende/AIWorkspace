import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { WechatCodeDto } from './dto/wechat-code.dto';
import { SetPasswordDto } from './dto/set-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  private readonly logger = new Logger(AuthController.name);

  @Post('register')
  register(
    @Body() registerDto: RegisterDto,
    @Headers('x-device-type') device_type?: string,
    @Headers('x-device-name') device_name?: string,
    @Headers('x-device-id') device_id?: string,
  ) {
    return this.authService.register({
      ...registerDto,
      device_type,
      device_name,
      device_id,
    });
  }

  @Post('login')
  login(
    @Body() loginDto: LoginDto,
    @Headers('x-device-type') device_type?: string,
    @Headers('x-device-name') device_name?: string,
    @Headers('x-device-id') device_id?: string,
  ) {
    this.logger.log(`收到登录请求: ${loginDto.email}`);
    return this.authService.login({
      ...loginDto,
      device_type,
      device_name,
      device_id,
    });
  }

  @Post('refresh')
  refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refreshToken(refreshDto.refresh_token);
  }

  /** 微信一键登录（小程序）：code 换 openid，自动建号或直接登录 */
  @Post('wechat/login')
  wechatLogin(
    @Body() dto: WechatCodeDto,
    @Headers('x-device-type') device_type?: string,
    @Headers('x-device-name') device_name?: string,
    @Headers('x-device-id') device_id?: string,
  ) {
    return this.authService.wechatLogin({
      code: dto.code,
      device_type,
      device_name,
      device_id,
    });
  }

  /** 绑定微信：为当前登录账号写入 openid */
  @UseGuards(JwtAuthGuard)
  @Post('wechat/bind')
  wechatBind(@CurrentUser() user: any, @Body() dto: WechatCodeDto) {
    return this.authService.wechatBind(user, dto.code);
  }

  /** 设置密码：仅对尚无密码的账号可用，不需要旧密码，成功后保留会话 */
  @UseGuards(JwtAuthGuard)
  @Post('set-password')
  setPassword(@CurrentUser() user: any, @Body() dto: SetPasswordDto) {
    return this.authService.setPassword(user.id, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      user.id,
      dto.oldPassword,
      dto.newPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  getSessions(
    @CurrentUser() user: any,
    @Query('device_id') device_id?: string,
  ) {
    return this.authService.getSessions(user.id, device_id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.authService.revokeSession(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  revokeAllSessions(
    @CurrentUser() user: any,
    @Query('except') except?: string,
  ) {
    const exceptTokenId =
      except === 'current' ? undefined : except ? parseInt(except) : undefined;

    return this.authService.revokeAllSessions(user.id, exceptTokenId);
  }
}
