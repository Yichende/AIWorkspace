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
  /**
   * refresh token 的 sha256 摘要（64 位 hex）。
   *
   * 注意它**不是 bcrypt 串** —— 历史上用过 bcrypt，但 bcrypt 只看输入的前
   * 72 字节，而 JWT 形态的 token 长 262 字符，导致同一用户的任意两个 token
   * 无法区分、重放检测失效。改用 sha256 的理由与实测证据见
   * `refresh-token-hash.ts`。
   *
   * 因此这个列里可能同时存在两种格式（历史行是 `$2b$10$…`）。无需迁移：
   * 换 JWT_REFRESH_SECRET 后那些 token 本来就已经验不过签名了。
   */
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

  /**
   * 客户端 IP。取自 `@Ip()`（走 Express 的 `req.ip`，所以 `trust proxy` 生效）。
   *
   * 这一列自建表起就存在，但**长期没有任何写入点** —— 直到本次加固才接上。
   * 可空表示「该会话创建于写入点存在之前」，历史行不回填。
   */
  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare ip_address: string;

  /**
   * 客户端 User-Agent（截断到 512）。
   *
   * 比 device_type / device_name 更可信：后两者都是**客户端自报**的请求头，
   * 可任意伪造；UA 由运行环境注入。仅用于「展示 + 人工比对」，
   * **不作为任何安全判据** —— 它同样可被伪造。
   */
  @Column({
    type: DataType.STRING(512),
    allowNull: true,
  })
  declare user_agent: string;

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
