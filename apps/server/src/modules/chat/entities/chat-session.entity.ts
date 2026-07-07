import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
} from 'sequelize-typescript';
import { DEFAULT_SESSION_TITLE, DEFAULT_MODEL } from '@repo/constants';
import { User } from '../../user/entities/user.entity';
import { ChatMessage } from './chat-message.entity';

@Table({
  tableName: 'chat_sessions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ fields: ['user_id'] }],
})
export class ChatSession extends Model {
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
    type: DataType.STRING(100),
    defaultValue: DEFAULT_SESSION_TITLE,
  })
  declare title: string;

  @Column({
    type: DataType.STRING(50),
    defaultValue: DEFAULT_MODEL,
  })
  declare model: string;

  @Column({
    type: DataType.INTEGER,
    defaultValue: 0,
    field: 'message_count',
  })
  declare messageCount: number;

  @HasMany(() => ChatMessage)
  declare messages: ChatMessage[];

  declare created_at: Date;
  declare updated_at: Date;
}
