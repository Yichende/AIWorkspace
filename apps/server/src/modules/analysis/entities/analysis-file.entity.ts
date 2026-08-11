import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { AnalysisSession } from './analysis-session.entity';

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
}
