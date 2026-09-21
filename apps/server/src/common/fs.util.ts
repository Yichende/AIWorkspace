import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('fs.util');

/**
 * 把数据库里存的相对路径（如 `uploads/analysis/123-456.xlsx`）解析为绝对路径。
 *
 * multer 的 diskStorage 以 `process.cwd()` 为基准写入，DB 存的是同一个相对路径，
 * 这里统一收敛解析逻辑（此前散落在 analysis.controller 与 analysis-queue.service）。
 */
export function resolveUploadPath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
}

/**
 * 删除本地文件：不存在 / 已被删除 / 权限失败都不抛，返回是否真的删掉了。
 *
 * ENOENT 静默返回 false —— 它正是并发清理（两轮同时选中同一文件）的正常结果，
 * 不应作为错误上报。其他错误记 warn 后返回 false，交给调用方决定是否继续。
 */
export function safeUnlink(filePath: string): boolean {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      logger.warn(`删除文件失败 ${filePath}: ${err?.message ?? err}`);
    }
    return false;
  }
}
