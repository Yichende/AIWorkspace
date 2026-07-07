import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateMessageDto {
  @IsString()
  @Length(10, 36)
  id: string;

  @IsString()
  role: 'user' | 'assistant';

  @IsArray()
  blocks: any[];

  @IsString()
  @IsOptional()
  status?: string;

  @IsOptional()
  createdAt?: number;
}

export class CreateSessionDto {
  @IsString()
  @Length(10, 36)
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
