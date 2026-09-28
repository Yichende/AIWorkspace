import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 20)
  username?: string;

  /**
   * 头像相对路径（如 /uploads/avatar/xxx.jpg），空串表示清除头像。
   *
   * 必须限定在本服务自己的头像目录：此前只有 @IsString + @MaxLength(255)，
   * 于是外部 URL、`javascript:` 之类的任意字符串都能落库。删除旧头像那条
   * 路径有 `startsWith` 兜底（不会逃出头像目录），但**展示侧没有任何校验** ——
   * 客户端会把它当图片地址加载。
   *
   * 已上线的客户端只发 `/upload/avatar` 返回的路径或 `{ username }`，
   * 从不回显存量值，所以这条收紧不会影响现有调用。
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^$|^\/uploads\/avatar\/[A-Za-z0-9._-]+$/, {
    message: '头像路径不合法，请重新上传头像',
  })
  avatar?: string;
}
