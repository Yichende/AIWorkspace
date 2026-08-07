import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { AnalysisFile } from './analysis-file.entity';
import { AnalysisChart } from './analysis-chart.entity';
import { AnalysisResult } from './analysis-result.entity';

export type AnalysisStatus = 'PENDING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

@Table({
  tableName: 'analysis_sessions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ fields: ['user_id'] }, { fields: ['status'] }],
})
export class AnalysisSession extends Model {
  @Column({
    type: DataType.STRING(36),
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'user_id',
  })
  declare userId: number;

  @BelongsTo(() => User)
  declare user: User;

  @Column({
    type: DataType.STRING(200),
    defaultValue: '数据分析',
  })
  declare title: string;

  @Column({
    type: DataType.ENUM('PENDING', 'ANALYZING', 'COMPLETED', 'FAILED'),
    defaultValue: 'PENDING',
  })
  declare status: AnalysisStatus;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
  })
  declare model: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare prompt: string;

  @HasMany(() => AnalysisFile)
  declare files: AnalysisFile[];

  @HasMany(() => AnalysisChart)
  declare charts: AnalysisChart[];

  @HasMany(() => AnalysisResult)
  declare results: AnalysisResult[];

  declare created_at: Date;
  declare updated_at: Date;
}
