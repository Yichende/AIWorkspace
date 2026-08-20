import { Type } from 'class-transformer';
import {
  IsOptional,
  IsInt,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@repo/constants';

export class QuerySessionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = DEFAULT_PAGE_SIZE;

  /** 按标题模糊搜索（可选） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
