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
  tableName: 'refresh_tokens',

  timestamps: true,

  createdAt: 'created_at',

  updatedAt: 'updated_at',
})
export class RefreshToken extends Model {
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare token_hash: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare user_id: number;

  @BelongsTo(() => User)
  declare user: User;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare device_type: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare device_name: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare device_id: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare ip_address: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare expires_at: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare last_used_at: Date;
}
