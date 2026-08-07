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
  tableName: 'analysis_results',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
})
export class AnalysisResult extends Model {
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
    field: 'analysis_id',
  })
  declare analysisId: string;

  @BelongsTo(() => AnalysisSession)
  declare analysis: AnalysisSession;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare summary: string;

  @Column({
    type: DataType.TEXT('long'),
    allowNull: true,
  })
  declare content: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  declare insights: string[];

  declare created_at: Date;
}
