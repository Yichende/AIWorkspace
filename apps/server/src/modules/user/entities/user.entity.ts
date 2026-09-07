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

    allowNull: true,

    unique: true,
  })
  declare email: string | null;

  @Column({
    type: DataType.STRING,

    allowNull: true,
  })
  declare password: string | null;

  /** 头像相对路径（如 /uploads/avatar/xxx.jpg），无头像为 null */
  @Column({
    type: DataType.STRING,

    allowNull: true,
  })
  declare avatar: string | null;

  /** 微信 openid（由迁移 20260907000000 落地），微信登录/绑定后写入 */
  @Column({
    type: DataType.STRING(64),

    allowNull: true,

    unique: true,
  })
  declare openid: string | null;

  @HasMany(() => RefreshToken)
  declare refresh_tokens: RefreshToken[];
}
