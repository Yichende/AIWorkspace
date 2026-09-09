import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { UpdateAnalysisDto } from './dto/update-analysis.dto';
import { QueryAnalysisDto } from './dto/query-analysis.dto';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import type { DatasetSummary } from '@repo/types';
import { DEFAULT_MODEL } from '@repo/constants';

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
    @Body('originalName') originalName?: string,
  ) {
    if (!file) {
      throw new Error('请选择文件');
    }

    // 原始文件名：小程序 uploadFile 的 multipart filename 是临时路径 basename
    // （内容哈希命名），真名由客户端经 formData.originalName 显式携带；
    // 缺省回退 multipart 的 originalname，并统一做安全清洗。
    const rawName = (originalName || file.originalname || '').trim();
    const displayName = this.sanitizeFileName(rawName);
    const fallbackName =
      displayName || this.sanitizeFileName(file.originalname) || '未命名文件';

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
      // SheetJS 解析：格式识别用真实上传文件名（保证扩展名正确）
      const dataset = this.parseFile(file.path, file.originalname);

      // 保存文件记录（临时，24h 过期）
      const fileRecord = await this.analysisService.saveFileRecord(
        null, // 暂不关联 session（create 时再关联）
        fallbackName,
        file.path,
        file.size,
      );

      return {
        fileId: String(fileRecord.id),
        fileName: fallbackName,
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
      model: dto.model ?? DEFAULT_MODEL,
      // 标题由 prompt 生成：prompt 为多行 textarea，需折叠空白/换行，
      // 否则小程序 text 组件会把 \n 渲染成换行（white-space 无法抑制）
      title: dto.prompt.replace(/\s+/g, ' ').trim().slice(0, 50),
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

    if (session.status === 'COMPLETED' || session.status === 'FAILED') {
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
        switch (event.type) {
          case 'thinking':
            sseWrite('thinking', event.delta);
            break;
          // 规范化四事件：summary / insights / report / chart
          case 'summary':
            sseWrite('summary', event.delta);
            break;
          case 'insights':
            sseWrite('insights', JSON.stringify({ items: event.items }));
            break;
          case 'report':
            sseWrite('report', event.delta);
            break;
          case 'chart':
            sseWrite('chart', JSON.stringify({ chart: event.chart }));
            break;
          case 'table':
            sseWrite('table', JSON.stringify({ table: event.table }));
            break;
          case 'progress':
            sseWrite(
              'progress',
              JSON.stringify({
                stage: event.stage,
                percent: event.percent,
              }),
            );
            break;
          case 'complete':
            sseWrite('complete', JSON.stringify(event.payload));
            break;
          case 'error':
            sseWrite('error', event.message);
            break;
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
    return this.analysisService.listSessions(
      user.id,
      query.page,
      query.limit,
      query.keyword?.trim(),
    );
  }

  // ── Detail ─────────────────────────────────────────────────

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getDetail(@CurrentUser() user: User, @Param('id') id: string) {
    return this.analysisService.getDetail(user.id, id);
  }

  // ── Delete / Rename ────────────────────────────────────────

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  deleteAnalysis(@CurrentUser() user: User, @Param('id') id: string) {
    return this.analysisService.deleteSession(user.id, id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  updateAnalysis(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateAnalysisDto,
  ) {
    return this.analysisService.updateSession(user.id, id, dto);
  }

  // ── Private Helpers ─────────────────────────────────────────

  /**
   * 文件名清洗：去路径分隔符/控制字符、折叠空白、截断 255（DB 列宽）。
   * 展示名可能来自客户端表单（formData.originalName），必须防御路径穿越。
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|\r\n\t]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 255);
  }

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
