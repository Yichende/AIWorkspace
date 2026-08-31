import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 20)
  username?: string;

  /** 头像相对路径（如 /uploads/avatar/xxx.jpg），空串表示清除头像 */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  avatar?: string;
}
