import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { ChatSession } from './chat-session.entity';

@Table({
  tableName: 'chat_messages',
  timestamps: false,
  indexes: [
    { fields: ['session_id'] },
    { fields: ['session_id', 'created_at'] },
  ],
})
export class ChatMessage extends Model {
  @Column({
    type: DataType.STRING(36),
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => ChatSession)
  @Column({
    type: DataType.STRING(36),
    allowNull: false,
    field: 'session_id',
  })
  declare sessionId: string;

  @BelongsTo(() => ChatSession)
  declare session: ChatSession;

  @Column({
    type: DataType.ENUM('user', 'assistant'),
    allowNull: false,
  })
  declare role: 'user' | 'assistant';

  @Column({
    type: DataType.JSON,
    allowNull: false,
  })
  declare blocks: any;

  @Column({
    type: DataType.ENUM('sending', 'streaming', 'success', 'error'),
    defaultValue: 'success',
  })
  declare status: string;

  @Column({
    type: DataType.BIGINT,
    allowNull: false,
    field: 'created_at',
  })
  declare createdAt: number;
}
