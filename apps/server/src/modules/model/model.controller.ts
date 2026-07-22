import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';
import { UserModelService } from './model.service';
import { CreateUserModelDto } from './dto/create-user-model.dto';
import { UpdateUserModelDto } from './dto/update-user-model.dto';
import { TestModelDto } from './dto/test-model.dto';

@Controller('models')
export class ModelController {
  constructor(private readonly userModelService: UserModelService) {}

  /** Get merged model list (builtin + user's custom) */
  @Get()
  @UseGuards(JwtAuthGuard)
  listModels(@CurrentUser() user: User) {
    return this.userModelService.getMergedModelList(user.id).then((models) => ({
      models,
    }));
  }

  /** Create a custom model */
  @Post()
  @UseGuards(JwtAuthGuard)
  createModel(@CurrentUser() user: User, @Body() dto: CreateUserModelDto) {
    return this.userModelService.create(user.id, dto);
  }

  /** Test model connectivity (rate-limited: 10 req/min) */
  @Post('test')
  @UseGuards(JwtAuthGuard)
  // TODO: install @nestjs/throttler and add @Throttle({ default: { limit: 10, ttl: 60000 } })
  testModel(@CurrentUser() user: User, @Body() dto: TestModelDto) {
    return this.userModelService.testModel(user.id, dto);
  }

  /** Get single custom model detail (for edit form) */
  @Get(':modelId')
  @UseGuards(JwtAuthGuard)
  getModel(@CurrentUser() user: User, @Param('modelId') modelId: string) {
    return this.userModelService.getDetail(user.id, modelId);
  }

  /** Update a custom model */
  @Patch(':modelId')
  @UseGuards(JwtAuthGuard)
  updateModel(
    @CurrentUser() user: User,
    @Param('modelId') modelId: string,
    @Body() dto: UpdateUserModelDto,
  ) {
    return this.userModelService.update(user.id, modelId, dto);
  }

  /** Soft-delete a custom model */
  @Delete(':modelId')
  @UseGuards(JwtAuthGuard)
  deleteModel(@CurrentUser() user: User, @Param('modelId') modelId: string) {
    return this.userModelService.remove(user.id, modelId);
  }
}
