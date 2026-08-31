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
