'use strict'
const fs = require('fs')
const path = require('path')

/**
 * 打包后清理：删除 Electron 自带的 LICENSES.chromium.html(~15M 许可文本)
 */
exports.default = async function (context) {
  const licenseFile = path.join(context.appOutDir, 'LICENSES.chromium.html')
  if (fs.existsSync(licenseFile)) {
    fs.unlinkSync(licenseFile)
    console.log('[afterPack] 已删除 LICENSES.chromium.html')
  }
}
