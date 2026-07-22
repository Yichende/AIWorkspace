import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';
import type { CreateUserModelRequest } from '@repo/types';

export class CreateUserModelDto implements CreateUserModelRequest {
  @IsString()
  @MaxLength(50)
  displayName: string;

  @IsString()
  @IsIn(['openai_compatible', 'ollama', 'anthropic'])
  protocolType: 'openai_compatible' | 'ollama' | 'anthropic';

  @IsString()
  @IsOptional()
  @MaxLength(50)
  provider?: string;

  @IsString()
  @MaxLength(100)
  apiModelName: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  apiBaseUrl?: string;

  @IsBoolean()
  @IsOptional()
  supportsThinking?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
