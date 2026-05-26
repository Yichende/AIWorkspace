import { IsEmail, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  declare email: string;

  @MinLength(6)
  declare password: string;
}
