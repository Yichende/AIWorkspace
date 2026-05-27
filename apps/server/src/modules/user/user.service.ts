import { Injectable } from '@nestjs/common';

@Injectable()
export class UserService {
  getProfile(user: any) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
    };
  }
}
