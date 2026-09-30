# 以「可远程调试」的方式启动 Tauri 开发窗口。
#
# WebView2 只在首次创建用户数据目录时读取 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS，
# 因此这里同时指定一个全新的临时 user-data-folder，确保 --remote-debugging-port 生效。
# 打开调试端口后，scripts/tauri_live_check.mjs 即可连上去验证真实运行时
# （Tauri IPC + 后端 CLI）的行为，而不仅是静态 DOM。
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

$debugPort = 9334
$userData = Join-Path $env:TEMP ("mtk-studio-webview2-" + (Get-Date -Format "yyyyMMddHHmmss"))

# 用用户级环境变量确保子进程（tauri dev → app → webview2）一定能继承
[Environment]::SetEnvironmentVariable(
  'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS',
  "--remote-debugging-port=$debugPort --remote-allow-origins=*",
  'User'
)
[Environment]::SetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER', $userData, 'User')

Write-Host "[tauri_dev_debug] 调试端口 $debugPort / user-data-folder $userData"

Set-Location 'D:\worker\mtk-porttool-master-ui'
try {
  pnpm tauri:dev 2>&1
} finally {
  # 清理用户级环境变量，避免影响后续正常启动
  [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $null, 'User')
  [Environment]::SetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER', $null, 'User')
  Write-Host "[tauri_dev_debug] 已清理调试环境变量"
}
