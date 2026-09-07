import { View, Text, Image, Input } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import { AppHeader, Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useUserStore } from '@/stores/user.store'
import {
  updateProfileApi,
  changePasswordApi,
  setPasswordApi,
  uploadAvatarApi,
  profileToUserInfo,
} from '@/services/user'
import { bindWechatAndRefresh } from '@/utils/wechat'
import { clearAllAuth } from '@/utils/auth'
import { useSettingsStore } from '@/stores/settings.store'
import './index.scss'

/** 弹窗状态：avatar = 更换头像，username = 用户名，password = 修改密码 */
type ModalType = 'avatar' | 'username' | 'password' | null

export default function ProfilePage() {
  const theme = useSettingsStore((s) => s.theme)
  const userInfo = useUserStore((s) => s.userInfo)
  const setUserInfo = useUserStore((s) => s.setUserInfo)

  const [modal, setModal] = useState<ModalType>(null)
  const [submitting, setSubmitting] = useState(false)

  // 是否有密码：false（微信账号）→ 密码行/弹窗走「设置密码」（免旧密码）
  // 兜底 true：避免 userInfo 未拉取（undefined）时误显设置密码入口
  const hasPassword = userInfo?.hasPassword ?? true

  // ── 头像 ──
  const [avatarTempPath, setAvatarTempPath] = useState('')

  // ── 用户名 ──
  const [usernameValue, setUsernameValue] = useState('')

  // ── 修改密码 ──
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const onBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  const closeModal = () => {
    setModal(null)
    setAvatarTempPath('')
  }

  // ── 头像 ────────────────────────────────────────────────

  const openAvatarModal = () => {
    setAvatarTempPath('')
    setModal('avatar')
  }

  const chooseAvatarImage = () => {
    Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        setAvatarTempPath(res.tempFilePaths[0])
      },
      fail: () => {
        // 用户取消选择，忽略
      },
    })
  }

  const confirmAvatar = async () => {
    if (!avatarTempPath || submitting) return
    setSubmitting(true)
    try {
      // 1. 上传新头像 → 2. PATCH 资料（服务端在 DB 更新成功后删除旧头像文件）
      const { url } = await uploadAvatarApi(avatarTempPath)
      const profile = await updateProfileApi({ avatar: url })
      setUserInfo(profileToUserInfo(profile))
      closeModal()
      Taro.showToast({ title: '头像已更新', icon: 'success' })
    } catch (err: any) {
      Taro.showToast({ title: err.message || '头像更新失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── 用户名 ──────────────────────────────────────────────

  const openUsernameModal = () => {
    setUsernameValue(userInfo?.username || '')
    setModal('username')
  }

  const confirmUsername = async () => {
    const username = usernameValue.trim()
    if (username.length < 2 || username.length > 20) {
      Taro.showToast({ title: '用户名需为 2-20 个字符', icon: 'none' })
      return
    }
    if (submitting) return
    setSubmitting(true)
    try {
      const profile = await updateProfileApi({ username })
      setUserInfo(profileToUserInfo(profile))
      setModal(null)
      Taro.showToast({ title: '用户名已更新', icon: 'success' })
    } catch (err: any) {
      Taro.showToast({ title: err.message || '更新失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── 修改密码 ────────────────────────────────────────────

  const openPasswordModal = () => {
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setModal('password')
  }

  const confirmPasswordChange = async () => {
    if (submitting) return
    if (hasPassword && !oldPassword) {
      Taro.showToast({ title: '请输入旧密码', icon: 'none' })
      return
    }
    if (newPassword.length < 6) {
      Taro.showToast({ title: '新密码至少 6 位', icon: 'none' })
      return
    }
    if (newPassword !== confirmPassword) {
      Taro.showToast({ title: '两次输入的新密码不一致', icon: 'none' })
      return
    }
    setSubmitting(true)
    try {
      if (hasPassword) {
        await changePasswordApi({ oldPassword, newPassword })
        // 服务端已撤销全部 refresh token —— 清除本地登录态并重新登录
        await clearAllAuth()
        useUserStore.getState().logout()
        Taro.showToast({ title: '密码已修改', icon: 'success' })
        setTimeout(() => {
          Taro.reLaunch({ url: '/pages/login/index' })
        }, 800)
      } else {
        // 微信账号：设置密码成功后保持登录（服务端保留当前会话）
        await setPasswordApi({ newPassword })
        const cur = useUserStore.getState().userInfo
        if (cur) {
          useUserStore.getState().setUserInfo({ ...cur, hasPassword: true })
        }
        setModal(null)
        Taro.showToast({ title: '密码已设置', icon: 'success' })
      }
    } catch (err: any) {
      Taro.showToast({
        title: err.message || (hasPassword ? '修改失败' : '设置失败'),
        icon: 'none',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // ── 微信绑定 ─────────────────────────────────────────────

  const handleWechatBinding = () => {
    void bindWechatAndRefresh()
  }

  return (
    <View className={`profile-page page-root theme-${theme}`}>
      <AppHeader title='个人信息' onBack={onBack} />

      <View className='profile-card'>
        {/* 更换头像 */}
        <View className='profile-row' onClick={openAvatarModal}>
          <Text className='profile-row__label'>更换头像</Text>
          <View className='profile-row__right'>
            {userInfo?.avatar ? (
              <Image
                className='profile-row__avatar'
                src={userInfo.avatar}
                mode='aspectFill'
              />
            ) : (
              <View className='profile-row__avatar profile-row__avatar--empty'>
                <Icon name='touxiang' size={40} color={IconColors.secondary} />
              </View>
            )}
            <Icon name='qianjin' size={28} color={IconColors.secondary} />
          </View>
        </View>

        {/* 用户名 */}
        <View className='profile-row' onClick={openUsernameModal}>
          <Text className='profile-row__label'>用户名</Text>
          <View className='profile-row__right'>
            <Text className='profile-row__value'>
              {userInfo?.username || '--'}
            </Text>
            <Icon name='qianjin' size={28} color={IconColors.secondary} />
          </View>
        </View>

        {/* 修改密码 / 设置密码（无密码账号走设置密码） */}
        <View className='profile-row' onClick={openPasswordModal}>
          <Text className='profile-row__label'>
            {hasPassword ? '修改密码' : '设置密码'}
          </Text>
          <View className='profile-row__right'>
            <Icon name='qianjin' size={28} color={IconColors.secondary} />
          </View>
        </View>

        {/* 微信绑定（已绑定/前往绑定，两页共用 bindWechatAndRefresh） */}
        <View className='profile-row' onClick={handleWechatBinding}>
          <Text className='profile-row__label'>微信绑定</Text>
          <View className='profile-row__right'>
            <Text className='profile-row__value'>
              {userInfo?.wechatBound ? '已绑定' : '前往绑定→'}
            </Text>
            <Icon name='qianjin' size={28} color={IconColors.secondary} />
          </View>
        </View>
      </View>

      {/* ── 弹窗 ─────────────────────────────────────────── */}
      {modal && (
        <View className='profile-modal-mask' onClick={closeModal}>
          <View
            className='profile-modal'
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            {modal === 'avatar' && (
              <>
                <Text className='profile-modal__title'>更换头像</Text>
                <View className='profile-modal__avatar-preview'>
                  {avatarTempPath ? (
                    <Image
                      className='profile-modal__avatar-img'
                      src={avatarTempPath}
                      mode='aspectFill'
                    />
                  ) : userInfo?.avatar ? (
                    <Image
                      className='profile-modal__avatar-img'
                      src={userInfo.avatar}
                      mode='aspectFill'
                    />
                  ) : (
                    <Icon
                      name='touxiang'
                      size={96}
                      color={IconColors.secondary}
                    />
                  )}
                </View>
                <View
                  className='profile-modal__pick-btn'
                  onClick={chooseAvatarImage}
                >
                  <Text>选择图片</Text>
                </View>
                <View className='profile-modal__actions'>
                  <View className='profile-modal__btn' onClick={closeModal}>
                    <Text>取消</Text>
                  </View>
                  <View
                    className={`profile-modal__btn profile-modal__btn--primary ${
                      avatarTempPath ? '' : 'disabled'
                    }`}
                    onClick={avatarTempPath ? confirmAvatar : undefined}
                  >
                    <Text>{submitting ? '上传中...' : '确认'}</Text>
                  </View>
                </View>
              </>
            )}

            {modal === 'username' && (
              <>
                <Text className='profile-modal__title'>修改用户名</Text>
                <Input
                  className='profile-modal__input'
                  value={usernameValue}
                  onInput={(e) => setUsernameValue(e.detail.value)}
                  placeholder='请输入用户名（2-20 个字符）'
                  maxlength={20}
                />
                <View className='profile-modal__actions'>
                  <View className='profile-modal__btn' onClick={closeModal}>
                    <Text>取消</Text>
                  </View>
                  <View
                    className='profile-modal__btn profile-modal__btn--primary'
                    onClick={confirmUsername}
                  >
                    <Text>确定</Text>
                  </View>
                </View>
              </>
            )}

            {modal === 'password' && (
              <>
                <Text className='profile-modal__title'>
                  {hasPassword ? '修改密码' : '设置密码'}
                </Text>
                {hasPassword && (
                  <Input
                    className='profile-modal__input'
                    password
                    value={oldPassword}
                    onInput={(e) => setOldPassword(e.detail.value)}
                    placeholder='旧密码'
                  />
                )}
                <Input
                  className='profile-modal__input'
                  password
                  value={newPassword}
                  onInput={(e) => setNewPassword(e.detail.value)}
                  placeholder='新密码（至少 6 位）'
                />
                <Input
                  className='profile-modal__input'
                  password
                  value={confirmPassword}
                  onInput={(e) => setConfirmPassword(e.detail.value)}
                  placeholder='确认新密码'
                />
                {hasPassword && (
                  <Text className='profile-modal__hint'>
                    修改成功后需重新登录
                  </Text>
                )}
                <View className='profile-modal__actions'>
                  <View className='profile-modal__btn' onClick={closeModal}>
                    <Text>取消</Text>
                  </View>
                  <View
                    className='profile-modal__btn profile-modal__btn--primary'
                    onClick={confirmPasswordChange}
                  >
                    <Text>{submitting ? '提交中...' : '确定'}</Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  )
}
