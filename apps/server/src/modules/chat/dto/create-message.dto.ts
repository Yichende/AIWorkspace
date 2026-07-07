import { IsString, IsArray, IsOptional, Length } from 'class-validator';

export class CreateMessageDto {
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
