import {
  BadRequestException,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile as UploadedFileDecorator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AVATAR_FORMATS, detectImageFormat } from './upload.constants';

/** multer v2 不自带类型，内联定义文件类型（与 analysis 模块同惯例） */
interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

@Controller('upload')
export class UploadController {
  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @CurrentUser() _user: unknown,
    @UploadedFileDecorator() file: UploadedFile | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('未收到上传文件');
    }

    // 以 magic bytes 判定实际格式（权威校验），不信任声明 MIME
    let detected: string | null = null;
    let finalName = '';
    try {
      const buf = this.readHeader(file.path);
      detected = detectImageFormat(buf);
      if (!detected) {
        throw new BadRequestException('仅支持 JPG/PNG/WebP 图片（≤5MB）');
      }

      // 校验通过：按实际格式重命名为最终文件名（随机，防覆盖/路径问题）
      const ext = AVATAR_FORMATS.find((f) => f.mime === detected)!.ext;
      finalName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      fs.renameSync(file.path, path.join(file.destination, finalName));
    } catch (err) {
      // 校验/重命名失败：清理临时文件（已重命名成功时无需清理）
      if (fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // 忽略清理失败
        }
      }
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException('仅支持 JPG/PNG/WebP 图片（≤5MB）');
    }

    return { url: `/uploads/avatar/${finalName}` };
  }

  /** 读取文件头 12 字节用于格式检测 */
  private readHeader(filePath: string): Buffer {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  }
}
