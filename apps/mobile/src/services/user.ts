import request from './request'

interface LoginParams {
  username: string

  password: string
}

interface LoginResult {
  access_token: string
}

/**
 * 登录
 */
export const loginApi = (data: LoginParams) => {
  return request<LoginResult>({
    url: '/auth/login',

    method: 'POST',

    data,
  })
}
