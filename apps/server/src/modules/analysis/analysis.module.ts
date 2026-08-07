import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MulterModule } from '@nestjs/platform-express';
import { AnalysisSession } from './entities/analysis-session.entity';
import { AnalysisFile } from './entities/analysis-file.entity';
import { AnalysisChart } from './entities/analysis-chart.entity';
import { AnalysisResult } from './entities/analysis-result.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnalysisQueueService } from './analysis-queue.service';
import { ModelModule } from '../model/model.module';
import { ModelResolver } from '../chat/model-resolver.service';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Module({
  imports: [
    SequelizeModule.forFeature([
      AnalysisSession,
      AnalysisFile,
      AnalysisChart,
      AnalysisResult,
    ]),
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads/analysis',
        filename: (_req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
    ModelModule, // 提供 ProviderFactory + UserModelService
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnalysisQueueService, ModelResolver],
  exports: [AnalysisService],
})
export class AnalysisModule {}
