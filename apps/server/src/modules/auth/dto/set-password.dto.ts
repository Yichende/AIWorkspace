import { MinLength } from 'class-validator';

/** 设置密码：仅对尚无密码的账号（如微信一键注册）可用，不需要旧密码 */
export class SetPasswordDto {
  @MinLength(6)
  declare newPassword: string;
}
