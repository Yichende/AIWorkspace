import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';

@Table({
  tableName: 'user_models',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['user_id', 'display_name'], unique: true },
  ],
})
export class UserModel extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  })
  declare id: number;

  @Column({
    type: DataType.STRING(36),
    allowNull: false,
    unique: true,
    field: 'model_id',
  })
  declare modelId: string;

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
    type: DataType.STRING(50),
    allowNull: false,
    field: 'display_name',
  })
  declare displayName: string;

  @Column({
    type: DataType.STRING(30),
    allowNull: false,
    field: 'protocol_type',
  })
  declare protocolType: string;

  @Column({
    type: DataType.STRING(50),
    allowNull: true,
  })
  declare provider: string | null;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
    field: 'api_model_name',
  })
  declare apiModelName: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
    field: 'encrypted_api_key',
  })
  declare encryptedApiKey: string | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
    field: 'api_base_url',
  })
  declare apiBaseUrl: string | null;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
    field: 'supports_thinking',
  })
  declare supportsThinking: boolean;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare notes: string | null;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
    field: 'is_active',
  })
  declare isActive: boolean;

  declare created_at: Date;
  declare updated_at: Date;
}
