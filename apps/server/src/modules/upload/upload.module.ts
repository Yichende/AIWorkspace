import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UploadController } from './upload.controller';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads/avatar',
        // 先写唯一临时文件名（防覆盖/防路径问题）；controller 校验
        // magic bytes 通过后按实际格式重命名为最终名（.png/.jpg/.webp）
        filename: (_req, _file, cb) => {
          const tempName = `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}.bin`;
          cb(null, tempName);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  ],
  controllers: [UploadController],
})
export class UploadModule {}
