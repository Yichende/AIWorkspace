import type {
  ModelListResponse,
  UserModelResponse,
  CreateUserModelRequest,
  UpdateUserModelRequest,
  ModelTestResult,
  ModelTestRequest,
} from '@repo/types'
import request from './request'

export const modelApi = {
  /** Get merged model list (builtin + custom) */
  listModels(): Promise<ModelListResponse> {
    return request({ url: '/models', method: 'GET' })
  },

  /** Create a new custom model */
  createModel(data: CreateUserModelRequest): Promise<UserModelResponse> {
    return request({ url: '/models', method: 'POST', data })
  },

  /** Get single model detail (for edit form) */
  getModel(modelId: string): Promise<UserModelResponse> {
    return request({ url: `/models/${modelId}`, method: 'GET' })
  },

  /** Update a custom model */
  updateModel(
    modelId: string,
    data: UpdateUserModelRequest,
  ): Promise<UserModelResponse> {
    return request({ url: `/models/${modelId}`, method: 'PATCH', data })
  },

  /** Soft-delete a custom model */
  deleteModel(modelId: string): Promise<void> {
    return request({ url: `/models/${modelId}`, method: 'DELETE' })
  },

  /** Test model connectivity */
  testModel(data: ModelTestRequest): Promise<ModelTestResult> {
    return request({ url: '/models/test', method: 'POST', data })
  },
}
