import { Table, Column, Model, DataType } from 'sequelize-typescript';

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
}
