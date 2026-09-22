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
  tableName: 'analysis_tables',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
})
export class AnalysisTable extends Model {
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

  /** 整份 TableConfig（id/title/columns/data）原样落库 */
  @Column({
    type: DataType.JSON,
    allowNull: false,
    field: 'table_config',
  })
  declare tableConfig: object;

  declare created_at: Date;
}
