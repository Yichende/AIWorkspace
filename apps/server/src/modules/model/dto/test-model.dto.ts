import { IsString, IsOptional, IsIn } from 'class-validator';
import type { ModelTestRequest } from '@repo/types';

export class TestModelDto implements ModelTestRequest {
  @IsString()
  @IsIn(['openai_compatible', 'ollama', 'anthropic'])
  protocolType: 'openai_compatible' | 'ollama' | 'anthropic';

  @IsString()
  apiModelName: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  apiBaseUrl?: string;
}
