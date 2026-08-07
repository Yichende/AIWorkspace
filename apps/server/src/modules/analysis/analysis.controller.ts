import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';
import { AnalysisService } from './analysis.service';
import { AnalysisQueueService } from './analysis-queue.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { QueryAnalysisDto } from './dto/query-analysis.dto';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import type { DatasetSummary } from '@repo/types';

/** multer v2 不自带类型，内联定义文件类型 */
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

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly queueService: AnalysisQueueService,
  ) {}

  // ── File Upload ────────────────────────────────────────────

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedFile,
  ) {
    if (!file) {
      throw new Error('请选择文件');
    }

    // 验证文件类型
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      // 删除临时文件
      fs.unlinkSync(file.path);
      throw new Error('仅支持 .xlsx .xls .csv 格式');
    }

    // 验证文件大小 (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      fs.unlinkSync(file.path);
      throw new Error('文件大小不能超过 10MB');
    }

    try {
      // SheetJS 解析
      const dataset = this.parseFile(file.path, file.originalname);

      // 保存文件记录（临时，24h 过期）
      const fileRecord = await this.analysisService.saveFileRecord(
        '', // 暂不关联 session（create 时再关联）
        file.originalname,
        file.path,
        file.size,
      );

      return {
        fileId: fileRecord.id,
        fileName: file.originalname,
        dataset,
      };
    } catch (err: any) {
      // 清理文件
      try {
        fs.unlinkSync(file.path);
      } catch {
        // 清理临时文件失败，忽略
      }
      throw new Error(`文件解析失败: ${err.message}`);
    }
  }

  // ── Create Analysis Task ───────────────────────────────────

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createAnalysis(
    @CurrentUser() user: User,
    @Body() dto: CreateAnalysisDto,
  ) {
    const session = await this.analysisService.createSession(user.id, {
      fileId: dto.fileId,
      prompt: dto.prompt,
      model: dto.model ?? 'DeepSeek-R1',
      title: dto.prompt.slice(0, 50),
    });

    return {
      id: session.id,
      status: 'PENDING' as const,
    };
  }

  // ── SSE Stream ─────────────────────────────────────────────

  @Get(':id/stream')
  @UseGuards(JwtAuthGuard)
  async streamAnalysis(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sseWrite = (event: string, data: string) => {
      const encoded = data.replace(/\n/g, '\ndata: ');
      res.write(`event: ${event}\ndata: ${encoded}\n\n`);
    };

    // 获取 session 信息
    const session = await this.analysisService.getSession(user.id, id);

    // 发送初始状态
    sseWrite(
      'status',
      JSON.stringify({ message: `任务状态: ${session.status}` }),
    );

    if (session.status === 'COMPLETED' || session.status === 'FAILED') {
      // 已完成的任务直接返回结果
      if (session.status === 'COMPLETED') {
        const detail = await this.analysisService.getDetail(user.id, id);
        sseWrite('complete', JSON.stringify(detail.result ?? {}));
      } else {
        sseWrite('error', '分析失败');
      }
      res.end();
      return;
    }

    // 执行分析管道
    try {
      for await (const event of this.queueService.execute(
        user.id,
        id,
        session.prompt ?? '',
        session.model,
      )) {
        if (event.type === 'complete') {
          sseWrite('complete', event.content);
        } else {
          sseWrite(event.type, event.content);
        }
      }
      res.end();
    } catch (err: any) {
      sseWrite('error', err.message || 'Stream error');
      res.end();
    }
  }

  // ── History List ───────────────────────────────────────────

  @Get('list')
  @UseGuards(JwtAuthGuard)
  listAnalyses(@CurrentUser() user: User, @Query() query: QueryAnalysisDto) {
    return this.analysisService.listSessions(user.id, query.page, query.limit);
  }

  // ── Detail ─────────────────────────────────────────────────

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getDetail(@CurrentUser() user: User, @Param('id') id: string) {
    return this.analysisService.getDetail(user.id, id);
  }

  // ── Private Helpers ─────────────────────────────────────────

  private parseFile(filePath: string, fileName: string): DatasetSummary {
    const ext = path.extname(fileName).toLowerCase();

    let rows: Record<string, any>[];

    if (ext === '.csv') {
      // CSV: 读取文件内容并用 XLSX 解析
      const content = fs.readFileSync(filePath, 'utf-8');
      const workbook = XLSX.read(content, { type: 'string' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet);
    } else {
      // Excel: 二进制读取
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet);
    }

    if (rows.length === 0) {
      throw new Error('文件为空或无法解析');
    }

    const columns = Object.keys(rows[0]);

    return {
      columns,
      rowCount: rows.length,
      columnCount: columns.length,
      preview: rows.slice(0, 5),
    };
  }
}
