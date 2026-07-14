/**
 * 解码 JWT payload（不验证签名，仅读取 exp）
 */
export const getTokenExpiry = (token: string): number | null => {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      )
    );
    return payload.exp ? payload.exp * 1000 : null; // 转毫秒
  } catch {
    return null;
  }
};

/**
 * 检查 token 是否即将过期
 * @param token JWT access token
 * @param thresholdMs 阈值（毫秒），默认 30 秒
 * @returns true = 需要刷新
 */
export const isTokenExpiringSoon = (
  token: string,
  thresholdMs = 30000
): boolean => {
  const exp = getTokenExpiry(token);
  if (!exp) return true; // 无法解析 → 保守处理，认为快过期
  return Date.now() >= exp - thresholdMs;
};
