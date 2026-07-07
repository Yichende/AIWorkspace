import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@repo/constants';

export class QueryMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  before?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = DEFAULT_PAGE_SIZE;
}
