import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as fs from 'fs';
import * as path from 'path';
import { User } from './entities/user.entity';

/** 头像静态目录前缀（与 main.ts useStaticAssets 配置一致） */
const AVATAR_URL_PREFIX = '/uploads/avatar/';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
  ) {}

  getProfile(user: any) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar ?? null,
      wechat_bound: !!user.openid,
      has_password: !!user.password,
    };
  }

  /**
   * 更新用户资料（username / avatar 均可选）。
   * avatar 变更且 DB 更新成功后，删除旧头像文件（失败仅记录，不阻断）。
   */
  async updateProfile(
    userId: number,
    dto: { username?: string; avatar?: string },
  ) {
    const user = await this.userModel.findByPk(userId);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const oldAvatar = user.avatar;
    const updateData: any = {};

    if (dto.username !== undefined) {
      updateData.username = dto.username;
    }
    if (dto.avatar !== undefined) {
      // 空串表示清除头像
      updateData.avatar = dto.avatar.trim() ? dto.avatar : null;
    }

    if (Object.keys(updateData).length > 0) {
      await user.update(updateData);
    }

    // DB 更新成功后再清理旧头像文件
    if (
      updateData.avatar !== undefined &&
      oldAvatar &&
      oldAvatar.startsWith(AVATAR_URL_PREFIX)
    ) {
      this.removeAvatarFile(oldAvatar);
    }

    return this.getProfile(user);
  }

  /** 按 URL 相对路径删除头像文件，失败静默（文件可能已不存在） */
  private removeAvatarFile(url: string) {
    try {
      const filename = path.basename(url);
      // 只允许删除头像目录内的文件（basename 已剥离路径分隔符）
      fs.unlinkSync(path.join(process.cwd(), 'uploads', 'avatar', filename));
    } catch {
      // 文件不存在或删除失败 — 忽略
    }
  }
}
