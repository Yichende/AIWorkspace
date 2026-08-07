import { IsString, IsOptional } from 'class-validator';

export class CreateAnalysisDto {
  @IsString()
  fileId: string;

  @IsString()
  prompt: string;

  @IsString()
  @IsOptional()
  model?: string;
}
