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
  tableName: 'analysis_charts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
})
export class AnalysisChart extends Model {
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
    type: DataType.STRING(20),
    allowNull: false,
    field: 'chart_type',
  })
  declare chartType: string;

  @Column({
    type: DataType.JSON,
    allowNull: false,
    field: 'chart_config',
  })
  declare chartConfig: object;

  declare created_at: Date;
}
