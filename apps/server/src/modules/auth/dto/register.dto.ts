import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  declare username: string;

  @IsEmail()
  declare email: string;

  @MinLength(6)
  declare password: string;
}
