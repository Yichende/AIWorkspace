import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';
import { AnalysisService } from './analysis.service';
import { AnalysisTaskService } from './analysis-task.service';
import { AnalysisWorkerService } from './analysis-worker.service';
import { AnalysisRunRegistry } from './analysis-run.registry';
import { safeUnlink } from '../../common/fs.util';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { UpdateAnalysisDto } from './dto/update-analysis.dto';
import { QueryAnalysisDto } from './dto/query-analysis.dto';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AnalysisCompletePayload,
  AnalysisEvent,
  DatasetSummary,
} from '@repo/types';
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
    private readonly taskService: AnalysisTaskService,
    private readonly worker: AnalysisWorkerService,
    private readonly registry: AnalysisRunRegistry,
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
      // 删除临时文件（safeUnlink：删不掉也不能盖掉真正的校验错误）
      safeUnlink(file.path);
      throw new Error('仅支持 .xlsx .xls .csv 格式');
    }

    // 验证文件大小 (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      safeUnlink(file.path);
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
      // 清理文件（失败不影响报错语义）
      safeUnlink(file.path);
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

    // 入队并立刻唤醒 worker —— 分析的启动不能依赖「客户端随后会订阅流」：
    // 客户端可能在 create 成功后立刻切后台/崩溃，那样任务永远不会开始。
    // enqueue 幂等，/stream 再来一次也无害。
    await this.taskService.enqueue(session.id);
    this.worker.wake();

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
    @Req() req: Request,
  ) {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // 立刻提交响应头：否则首字节要等到建连 + 读文件 + 解析 xlsx 之后，
    // 而小程序的 networkTimeout.request 是按「等响应开始」计的
    res.flushHeaders();

    let aborted = false;

    // 断连后所有写入都变 no-op：socket 已经没了，写进去只会抛 ERR_STREAM_WRITE_AFTER_END
    const safeWrite = (chunk: string) => {
      if (aborted || res.writableEnded || res.destroyed) return;
      try {
        res.write(chunk);
      } catch {
        // socket 已断
      }
    };

    const sseWrite = (event: string, data: string) => {
      const encoded = data.replace(/\n/g, '\ndata: ');
      safeWrite(`event: ${event}\ndata: ${encoded}\n\n`);
    };

    // 注释帧心跳（`: ping`）：分析阶段可能几十秒无事件，防小程序/反代判死。
    // 前提是每次写出的都是完整帧（含结尾 \n\n），心跳才只会落在帧与帧之间 ——
    // 详见 chat.controller 同处注释与 tests/sse.test.ts 的对应断言。
    const heartbeat = setInterval(() => safeWrite(': ping\n\n'), 15_000);

    // 断开只是「少了一个听众」：运行在 worker 里继续跑完。
    // 只有显式 cancel 才会中断上游（见 POST /analysis/:id/cancel）。
    req.on('close', () => {
      if (res.writableEnded) return;
      aborted = true;
    });

    let unsubscribe: (() => void) | undefined;

    try {
      // 获取 session 信息
      const session = await this.analysisService.getSession(user.id, id);

      // 终态会话：补发历史结果
      if (session.status === 'COMPLETED' || session.status === 'FAILED') {
        if (session.status === 'COMPLETED') {
          const detail = await this.analysisService.getDetail(user.id, id);
          if (!detail.result) {
            // COMPLETED 却没有结果行属坏状态，不能把 {} 当结果下发
            sseWrite('error', '分析结果不存在');
          } else {
            const payload: AnalysisCompletePayload = {
              summary: detail.result.summary,
              content: detail.result.content,
              charts: detail.charts ?? [],
              tables: detail.result.tables ?? [],
              insights: detail.result.insights ?? [],
            };
            sseWrite('complete', JSON.stringify(payload));
          }
        } else {
          sseWrite('error', '分析失败');
        }
        return;
      }

      // 非终态：确保有任务在跑（幂等），然后**订阅**它 ——
      // 不再在请求内执行管道。两个订阅者因此共享同一个运行，
      // 而不是各跑一遍写出重复结果。
      await this.taskService.enqueue(id);
      this.worker.wake();

      const sub = this.registry.subscribe(id, (event) => {
        if (aborted) return;
        this.writeEvent(sseWrite, event);
      });
      unsubscribe = sub.unsubscribe;

      // 订阅前已产出的事件先重放（best-effort：缓冲区有上限）
      for (const item of sub.replay) {
        if (aborted) break;
        this.writeEvent(sseWrite, item.event);
      }

      // 运行已结束（刚好错过）时不必等心跳：补一次终态
      if (!this.registry.has(id)) {
        const latest = await this.taskService.findLatest(id);
        if (latest?.state === 'FAILED') {
          sseWrite('error', latest.errorMessage || '分析失败');
        } else if (latest?.state === 'CANCELED') {
          sseWrite('error', latest.errorMessage || '已取消');
        }
      }
    } catch (err: any) {
      // 客户端已断开时不再尝试写 error 帧（没人听）
      if (!aborted) {
        sseWrite('error', err.message || 'Stream error');
      }
    } finally {
      unsubscribe?.();
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        // 已销毁
      }
    }
  }

  /** 把管道事件写成 SSE 帧（唯一的事件→帧映射点） */
  private writeEvent(
    sseWrite: (event: string, data: string) => void,
    event: AnalysisEvent,
  ): void {
    switch (event.type) {
      case 'thinking':
        sseWrite('thinking', event.delta);
        break;
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
          JSON.stringify({ stage: event.stage, percent: event.percent }),
        );
        break;
      case 'complete': {
        // 线上负载是裸 AnalysisResult（无 payload 包裹），
        // 显式构造以让编译器校验全部 5 个字段
        const payload: AnalysisCompletePayload = {
          summary: event.payload.summary,
          content: event.payload.content,
          charts: event.payload.charts,
          tables: event.payload.tables,
          insights: event.payload.insights,
        };
        sseWrite('complete', JSON.stringify(payload));
        break;
      }
      case 'error':
        sseWrite('error', event.message);
        break;
    }
  }

  // ── Cancel ─────────────────────────────────────────────────

  /**
   * 取消正在跑的分析。
   *
   * 状态分派见 `AnalysisTaskService.cancelBySession` 的注释 —— 关键是要能
   * 接住「任务刚被僵死回收重排成 QUEUED」这个窗口。
   */
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelAnalysis(@CurrentUser() user: User, @Param('id') id: string) {
    // 归属校验（非本人会话直接 403/404）
    await this.analysisService.getSession(user.id, id);

    const { canceled, wasRunning } = await this.taskService.cancelBySession(id);
    if (!canceled) {
      return { success: false, message: '没有进行中的分析' };
    }

    // 会话状态映射为 FAILED（session ENUM 没有 CANCELED，也不需要为它加值）
    await this.analysisService.updateStatus(id, 'FAILED');

    if (wasRunning) {
      this.worker.abortRun(id);
    }
    return { success: true };
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
