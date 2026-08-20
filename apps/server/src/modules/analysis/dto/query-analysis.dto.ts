import {
  IsOptional,
  IsInt,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAnalysisDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  /** 按标题模糊搜索（可选） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
