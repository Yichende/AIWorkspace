import { IsString, IsOptional } from 'class-validator';

export class UpdateAnalysisDto {
  @IsString()
  @IsOptional()
  title?: string;
}
