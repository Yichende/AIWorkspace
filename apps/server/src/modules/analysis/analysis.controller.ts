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

/**
 * 单条 SSE 连接的兜底上限。
 *
 * 语义是**传输层超时**，不是分析失败、更不是取消：到点只收掉这条连接，
 * worker 里的运行照跑，会话状态不变。取值远大于单次分析的合理时长（5–15 分钟）。
 */
const STREAM_MAX_MS = 30 * 60 * 1000;

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
    /** 客户端游标：只回放 seq > after 的事件。缺省/非法值按 0（全量回放）处理 */
    @Query('after') after: string | undefined,
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

    const sseWrite = (event: string, data: string, seq?: number) => {
      const encoded = data.replace(/\n/g, '\ndata: ');
      // seq 有值时前置一行 `id:`，客户端据此维护游标并原样回传到 `?after=`。
      // 只加 `id:` 这一行，9 类既有帧的 data 负载格式一律不动。
      // 终态补发帧、timeout、truncated、done 都没有 seq，不写 id。
      const idLine = typeof seq === 'number' ? `id: ${seq}\n` : '';
      safeWrite(`${idLine}event: ${event}\ndata: ${encoded}\n\n`);
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
      resolveWait?.();
    });

    let unsubscribe: (() => void) | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let wroteTerminal = false;

    // 收尾汇合点：运行结束 / 超时 / 客户端断开，任一发生都让它 resolve，
    // 保证 finally 一定会跑。少了它，客户端断开后还会抱着订阅和定时器
    // 死等到运行结束。
    let resolveWait: (() => void) | undefined;
    const waitDone = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });

    /** 统一事件出口：顺带记录是否已写过终态帧，供收尾判断要不要补 */
    const handleEvent = (event: AnalysisEvent, seq?: number) => {
      if (aborted) return;
      if (event.type === 'complete' || event.type === 'error')
        wroteTerminal = true;
      this.writeEvent(sseWrite, event, seq);
    };

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

      const fromSeq = Math.max(0, Number.parseInt(after ?? '', 10) || 0);
      const sub = this.registry.subscribe(id, handleEvent, { fromSeq });
      unsubscribe = sub.unsubscribe;

      // 游标掉出保留窗口：先把可续传位置告诉客户端，它才知道要丢掉残缺缓冲。
      // 必须在 replay 之前发 —— 否则客户端会先把残缺片段拼进正文。
      // 注意 replay 仍然是「服务端现存的全量」，所以客户端无需重连。
      if (sub.truncated) {
        sseWrite('truncated', JSON.stringify({ firstSeq: sub.firstSeq ?? 1 }));
      }

      // 订阅前已产出的事件先重放（best-effort：缓冲区有上限）
      for (const item of sub.replay) {
        if (aborted) break;
        handleEvent(item.event, item.seq);
      }

      // 运行从没启动过、也没有任何缓冲：任务可能早已终态（运行结束且已过保留期）。
      // 这种情况干等 done 会一直挂到超时，先查一次任务状态直接收尾。
      if (!sub.started && sub.lastSeq === null) {
        const latest = await this.taskService.findLatest(id);
        if (!latest) {
          sseWrite('error', '分析任务不存在');
          return;
        }
        if (latest.state === 'FAILED' || latest.state === 'CANCELED') {
          sseWrite('error', latest.errorMessage || '分析失败');
          return;
        }
      }

      // 关键：必须等运行结束才落到 finally。
      // 少了这层 await，handler 会在 subscribe 之后同步走到底，res.end() 立刻
      // 把连接关掉，此后所有事件的写入因 writableEnded 全部变成 no-op
      // —— 这正是阶段一重构引入的回归。
      let timedOut = false;
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        // 只收连接、不动运行：客户端据此区分「超时」与「失败 / 取消」
        sseWrite(
          'timeout',
          JSON.stringify({ message: '连接超时，分析仍在后台进行' }),
        );
        resolveWait?.();
      }, STREAM_MAX_MS);
      timeoutTimer.unref?.();
      void sub.done.then(() => resolveWait?.());
      await waitDone;

      // 收尾补终态：管道被中断（取消 / 重排）时可能一个终态帧都没发过，
      // 不补的话客户端只能靠静默断连兜底，被误判成「连接中断，请重试」。
      if (!aborted && !timedOut && !wroteTerminal) {
        const latest = await this.taskService.findLatest(id);
        if (latest?.state === 'FAILED') {
          sseWrite('error', latest.errorMessage || '分析失败');
        } else if (latest?.state === 'CANCELED') {
          sseWrite('error', latest.errorMessage || '已取消');
        } else {
          sseWrite('done', '');
        }
      }
    } catch (err: any) {
      // 客户端已断开时不再尝试写 error 帧（没人听）
      if (!aborted) {
        sseWrite('error', err.message || 'Stream error');
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
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
    write: (event: string, data: string, seq?: number) => void,
    event: AnalysisEvent,
    seq?: number,
  ): void {
    // 一个事件对应一帧，seq 就是该事件自身的序号。局部重绑后下面的 switch
    // 分支不用逐个改签名。
    const sseWrite = (e: string, d: string) => write(e, d, seq);
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
