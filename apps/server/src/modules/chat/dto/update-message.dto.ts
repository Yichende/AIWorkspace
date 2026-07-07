import { IsArray, IsString, IsOptional } from 'class-validator';

export class UpdateMessageDto {
  @IsArray()
  @IsOptional()
  blocks?: any[];

  @IsString()
  @IsOptional()
  status?: string;
}
