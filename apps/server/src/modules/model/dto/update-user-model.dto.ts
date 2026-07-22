import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import type { UpdateUserModelRequest } from '@repo/types';

export class UpdateUserModelDto implements UpdateUserModelRequest {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  displayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  provider?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  apiModelName?: string;

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
