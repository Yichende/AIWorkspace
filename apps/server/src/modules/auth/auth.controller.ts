import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';
import { RATE_LIMITS } from '../../config/throttle.config';

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

  /** 注册：bcrypt cost 10 + 写库，且无需登录即可调用，单独收紧 */
  @Throttle({ default: RATE_LIMITS.register })
  @Post('register')
  register(
    @Body() registerDto: RegisterDto,
    @Ip() ip_address: string,
    @Headers('user-agent') user_agent?: string,
    @Headers('x-device-type') device_type?: string,
    @Headers('x-device-name') device_name?: string,
    @Headers('x-device-id') device_id?: string,
  ) {
    return this.authService.register({
      ...registerDto,
      device_type,
      device_name,
      device_id,
      ip_address,
      user_agent,
    });
  }

  /** 登录：限流挡的是撞库与 CPU 消耗，不是正常重试 */
  @Throttle({ default: RATE_LIMITS.login })
  @Post('login')
  login(
    @Body() loginDto: LoginDto,
    @Ip() ip_address: string,
    @Headers('user-agent') user_agent?: string,
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
      ip_address,
      user_agent,
    });
  }

  /** 刷新：额度刻意给得比默认值宽，理由见 RATE_LIMITS.refresh 注释 */
  @Throttle({ default: RATE_LIMITS.refresh })
  @Post('refresh')
  refresh(
    @Body() refreshDto: RefreshDto,
    @Ip() ip_address: string,
    @Headers('user-agent') user_agent?: string,
  ) {
    // 轮转点也刷新指纹：换了网络或客户端的话，会话列表里的值应当跟着变
    return this.authService.refreshToken(refreshDto.refresh_token, {
      ip_address,
      user_agent,
    });
  }

  /** 微信一键登录（小程序）：code 换 openid，自动建号或直接登录 */
  @Throttle({ default: RATE_LIMITS.wechatLogin })
  @Post('wechat/login')
  wechatLogin(
    @Body() dto: WechatCodeDto,
    @Ip() ip_address: string,
    @Headers('user-agent') user_agent?: string,
    @Headers('x-device-type') device_type?: string,
    @Headers('x-device-name') device_name?: string,
    @Headers('x-device-id') device_id?: string,
  ) {
    return this.authService.wechatLogin({
      code: dto.code,
      device_type,
      device_name,
      device_id,
      ip_address,
      user_agent,
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
