import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

@Table({
  tableName: 'users',

  timestamps: true,

  createdAt: 'created_at',

  updatedAt: 'updated_at',
})
export class User extends Model {
  @Column({
    type: DataType.STRING,

    allowNull: false,
  })
  declare username: string;

  @Column({
    type: DataType.STRING,

    allowNull: false,

    unique: true,
  })
  declare email: string;

  @Column({
    type: DataType.STRING,

    allowNull: false,
  })
  declare password: string;

  /** 头像相对路径（如 /uploads/avatar/xxx.jpg），无头像为 null */
  @Column({
    type: DataType.STRING,

    allowNull: true,
  })
  declare avatar: string | null;

  @HasMany(() => RefreshToken)
  declare refresh_tokens: RefreshToken[];
}
