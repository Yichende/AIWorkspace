import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MulterModule } from '@nestjs/platform-express';
import { AnalysisSession } from './entities/analysis-session.entity';
import { AnalysisFile } from './entities/analysis-file.entity';
import { AnalysisChart } from './entities/analysis-chart.entity';
import { AnalysisResult } from './entities/analysis-result.entity';
import { AnalysisTable } from './entities/analysis-table.entity';
import { AnalysisTask } from './entities/analysis-task.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { AnalysisQueueService } from './analysis-queue.service';
import { AnalysisCleanupService } from './analysis-cleanup.service';
import { AnalysisTaskService } from './analysis-task.service';
import { AnalysisWorkerService } from './analysis-worker.service';
import { AnalysisRunRegistry } from './analysis-run.registry';
import { ModelModule } from '../model/model.module';
import { ModelResolver } from '../chat/model-resolver.service';
import { diskStorage } from 'multer';
import { extname } from 'path';
import {
  ALLOWED_ANALYSIS_EXTS,
  MAX_ANALYSIS_FILE_BYTES,
} from './analysis-file.constants';

@Module({
  imports: [
    SequelizeModule.forFeature([
      AnalysisSession,
      AnalysisFile,
      AnalysisChart,
      AnalysisResult,
      AnalysisTable,
      AnalysisTask,
    ]),
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads/analysis',
        filename: (_req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          // 扩展名只作展示线索：不在白名单内一律落 .bin，
          // 免得把客户端给的任意后缀（.php / .jsp / .html）写进磁盘目录。
          // 目录本身不对外静态服务，但双层防御的成本是零。
          const ext = extname(file.originalname).toLowerCase();
          const safeExt = (ALLOWED_ANALYSIS_EXTS as readonly string[]).includes(
            ext,
          )
            ? ext
            : '.bin';
          cb(null, `${uniqueSuffix}${safeExt}`);
        },
      }),
      // 体积上限前移到 multer：超限时 busboy 立刻中断上传并自行清理半截文件，
      // 不再「先落 10MB+ 到磁盘、再在 controller 里发现超限」。
      limits: { fileSize: MAX_ANALYSIS_FILE_BYTES },
    }),
    ModelModule, // 提供 ProviderFactory + UserModelService
  ],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    AnalysisQueueService,
    ModelResolver,
    AnalysisCleanupService,
    AnalysisTaskService,
    AnalysisRunRegistry,
    AnalysisWorkerService,
  ],
  exports: [AnalysisService],
})
export class AnalysisModule {}
