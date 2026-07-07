import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ID_MIN_LENGTH, ID_MAX_LENGTH } from '@repo/constants';
import type { CreateSessionParams } from '@repo/types';
import { CreateMessageDto } from './create-message.dto';

export class CreateSessionDto implements CreateSessionParams {
  @IsString()
  @Length(ID_MIN_LENGTH, ID_MAX_LENGTH)
  id: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  model: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMessageDto)
  @IsOptional()
  messages?: CreateMessageDto[];
}
