import Taro from '@tarojs/taro'
import { getToken, removeToken } from '@/utils/auth'
import { useUserStore } from '@/stores/user.store'

const BASE_URL = 'http://localhost:3000'

interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: any
  header?: Record<string, string>
}

const request = async <T>(options: RequestOptions) => {
  const token = await getToken()

  try {
    const res = await Taro.request<T>({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        ...options.header,
        Authorization: token ? `Bearer ${token}` : '',
      },
    })

    // token 失效
    if (res.statusCode === 401) {
      await removeToken()

      useUserStore.getState().logout()

      Taro.reLaunch({
        url: '/pages/login/index',
      })

      return Promise.reject('登录失效')
    }

    // 请求失败
    if (res.statusCode !== 200) {
      return Promise.reject(res.data);
    }

    return res.data
  } catch (error) {
    return Promise.reject(error)
  }
}

export default request
