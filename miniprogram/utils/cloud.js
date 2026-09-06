/**
 * 云函数调用统一封装
 * 约定：云函数一律返回 { success: true, data, ... } 或 { success: false, errCode, message }
 * 这里把失败统一转成 reject，页面只需 try/catch。
 */

const ERR_MESSAGE = {
  INVALID_PARAM: '提交内容有误，请检查后重试',
  FORBIDDEN: '你没有该操作权限',
  NOT_FOUND: '记录不存在或已被删除',
  ALREADY_HANDLED: '该申请已被处理，无需重复审批',
  NETWORK: '加载失败，请检查网络',
};

/**
 * @param {string} name 云函数名
 * @param {object} data 入参（不要传 openid / 时间，服务端自取）
 * @returns {Promise<object>} 云函数 result
 */
function callFunction(name, data = {}) {
  return wx.cloud
    .callFunction({ name, data })
    .then((res) => {
      const result = res && res.result;
      if (!result || typeof result !== 'object') {
        throw makeError('NETWORK', '返回数据异常');
      }
      if (result.success) return result;
      throw makeError(result.errCode || 'UNKNOWN', result.message);
    })
    .catch((err) => {
      // 网络层失败（云函数未部署 / 断网 / 超时）也走这里
      if (err && err.errCode) throw err;
      throw makeError('NETWORK', (err && err.errMsg) || '');
    });
}

function makeError(errCode, message) {
  const err = new Error(message || ERR_MESSAGE[errCode] || '操作失败，请稍后重试');
  err.errCode = errCode;
  err.friendlyMessage = ERR_MESSAGE[errCode] || err.message;
  return err;
}

module.exports = { callFunction, ERR_MESSAGE };
