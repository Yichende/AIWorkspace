import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { AnalysisSession } from './analysis-session.entity';
import { User } from '../../user/entities/user.entity';

@Table({
  tableName: 'analysis_files',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
})
export class AnalysisFile extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @ForeignKey(() => AnalysisSession)
  @Column({
    type: DataType.STRING(36),
    allowNull: true,
    field: 'analysis_id',
  })
  declare analysisId: string | null;

  @BelongsTo(() => AnalysisSession)
  declare analysis: AnalysisSession;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    field: 'file_name',
  })
  declare fileName: string;

  @Column({
    type: DataType.STRING(500),
    allowNull: false,
    field: 'file_url',
  })
  declare fileUrl: string;

  @Column({
    type: DataType.INTEGER,
    defaultValue: 0,
  })
  declare size: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    field: 'expire_at',
  })
  declare expireAt: Date;

  declare created_at: Date;

  /**
   * 上传者。**归属的唯一写入点是 `AnalysisService.saveFileRecord`**，
   * `createSession` 依赖它做越权校验。
   *
   * 允许为 null 是诚实的描述而非设计意图：本列由
   * `20260928000000-add-user-id-to-analysis-files` 补上时，存量行无从得知
   * 归属（能反推的已回填，其余保持 NULL）。「新行必有归属」由代码保证，
   * 不由 DB 的 NOT NULL 保证 —— 那样迁移会在存量行上直接失败。
   */
  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'user_id',
  })
  declare userId: number | null;

  @BelongsTo(() => User)
  declare user: User;
}
