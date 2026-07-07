import { IsArray, IsString, IsOptional } from 'class-validator';
import type { UpdateMessageParams, MessageStatus } from '@repo/types';

export class UpdateMessageDto implements UpdateMessageParams {
  @IsArray()
  @IsOptional()
  blocks?: any[];

  @IsString()
  @IsOptional()
  status?: MessageStatus;
}
