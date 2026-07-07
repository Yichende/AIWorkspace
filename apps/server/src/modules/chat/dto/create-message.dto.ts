import { IsString, IsArray, IsOptional, Length } from 'class-validator';
import { ID_MIN_LENGTH, ID_MAX_LENGTH } from '@repo/constants';
import type { CreateMessageParams, MessageStatus } from '@repo/types';

export class CreateMessageDto implements CreateMessageParams {
  @IsString()
  @Length(ID_MIN_LENGTH, ID_MAX_LENGTH)
  id: string;

  @IsString()
  role: 'user' | 'assistant';

  @IsArray()
  blocks: any[];

  @IsString()
  @IsOptional()
  status?: MessageStatus;

  @IsOptional()
  createdAt?: number;
}
