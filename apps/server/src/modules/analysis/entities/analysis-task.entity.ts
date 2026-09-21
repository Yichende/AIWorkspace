import {
  Column,
  DataType,
  ForeignKey,
  BelongsTo,
  Model,
  Table,
} from 'sequelize-typescript';
import { AnalysisSession } from './analysis-session.entity';

/** 单次运行的执行状态（对用户不可见；用户看到的是 analysis_sessions.status） */
export type AnalysisTaskState =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED';

/**
 * 一次分析运行的执行记录。
 *
 * 为什么不把这些列加在 `analysis_sessions` 上：
 *  1. **`synchronize: true` 不会给已存在的表加列**（alter 默认关闭）。加列意味着
 *     任何忘记跑 `db:migrate` 的环境会在 `/analysis/*` 上直接撞 unknown column；
 *     而**新建表会被 sync 自动建好**，迁移因此退化为幂等的记账，弄不坏任何人的启动。
 *  2. 一次运行一行：`attempt`/`started_at`/`finished_at`/`error_message` 属于「这次运行」
 *     而非「这个会话」，会话可重跑且不覆盖上次的运行痕迹。
 *  3. `CANCELED` 落在任务行上，**不必改 session 的 ENUM**（改 ENUM 要 ALTER TABLE MODIFY）。
 *
 * 不变量：`analysis_sessions.status` 仍是唯一对用户可见的状态，worker 在原位置写入；
 * 本表只承载执行细节（进度、租约、心跳、失败原因）。
 */
@Table({
  tableName: 'analysis_tasks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['session_id'] },
    { fields: ['state', 'created_at'] },
    { fields: ['heartbeat_at'] },
  ],
})
export class AnalysisTask extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @ForeignKey(() => AnalysisSession)
  @Column({
    type: DataType.STRING(36),
    allowNull: false,
    field: 'session_id',
  })
  declare sessionId: string;

  @BelongsTo(() => AnalysisSession)
  declare session: AnalysisSession;

  @Column({
    type: DataType.ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'),
    allowNull: false,
    defaultValue: 'QUEUED',
  })
  declare state: AnalysisTaskState;

  /** 与 ProgressStage 对应（upload/parse/profiling/analyzing/rendering） */
  @Column({
    type: DataType.STRING(20),
    allowNull: true,
    field: 'progress_stage',
  })
  declare progressStage: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'progress_percent',
  })
  declare progressPercent: number | null;

  /** 第几次尝试（领取时 +1）；用于限制崩溃重跑次数 */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare attempt: number;

  /** `hostname:pid` —— 为将来多进程留的字段，当前单进程也写入以便排查 */
  @Column({ type: DataType.STRING(64), allowNull: true, field: 'locked_by' })
  declare lockedBy: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'locked_at' })
  declare lockedAt: Date | null;

  /**
   * 存活信号：**僵死判定的唯一依据**。
   *
   * ⚠️ 心跳绝不能顺手更新 `analysis_sessions.updated_at` ——
   * 那会让兜底的 `failStaleAnalyzingSessions` 静默失效并掩盖一个烂掉的兜底。
   */
  @Column({ type: DataType.DATE, allowNull: true, field: 'heartbeat_at' })
  declare heartbeatAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'started_at' })
  declare startedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'finished_at' })
  declare finishedAt: Date | null;

  @Column({
    type: DataType.STRING(500),
    allowNull: true,
    field: 'error_message',
  })
  declare errorMessage: string | null;

  declare created_at: Date;
  declare updated_at: Date;
}
