import { IsNotEmpty, IsString } from 'class-validator';

/** 微信登录/绑定：小程序 Taro.login() 产出的临时凭证 code */
export class WechatCodeDto {
  @IsString()
  @IsNotEmpty()
  declare code: string;
}
