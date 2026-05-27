# AGENTS.md

## Safety Rules

禁止批量删除文件或目录。

不要使用：

```powershell
del /s
rd /s
rmdir /s
Remove-Item -Recurse
rm -rf
```

需要删除文件时，只能一次删除一个明确路径的文件。

正确示例：

```powershell
Remove-Item "C:\path\to\file.txt"
```

如果需要批量删除文件，应停止操作，并向用户请求，让用户手动删除。

## Project Service Monitoring

当 Codex 进入本项目并需要运行或验证功能时，默认可以自行检查并启动本地服务，不需要每次都询问用户。

项目默认服务：

- 主服务：`npm.cmd run dev` 或 `npm.cmd start`
- 默认访问地址：`http://127.0.0.1:8080`
- 服务入口：`server.js`
- 运行端口：优先读取 `.env` 的 `PORT`，未设置时使用 `8080`
- 网易云本地 API：主服务启动后会尝试自动拉起 `NeteaseCloudMusicApi`，默认端口 `3000`

推荐流程：

1. 先检查仓库状态，避免覆盖用户正在修改的内容：

```powershell
git status --short --branch
```

2. 检查主服务是否已经可访问：

```powershell
Invoke-WebRequest http://127.0.0.1:8080/ -UseBasicParsing
```

3. 如果主服务未运行，可以在后台启动：

```powershell
Start-Process -WindowStyle Hidden -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory "D:\gemini-Antigravity\AI音乐电台"
```

4. 启动后再次访问 `http://127.0.0.1:8080/` 验证是否成功。

5. 如需排查启动失败，优先读取终端输出、`package.json`、`.env.example`、`server.js`，不要先改业务代码。

注意事项：

- Windows 环境中优先使用 `npm.cmd`，不要优先使用 `npm` 或 `npm.ps1`。
- 不要因为端口冲突就强制终止进程；应先报告占用情况，并询问用户是否要停止对应进程。
- 不要提交 `.env`、`state.json`、日志文件或运行时缓存。
- `taste.md` 和 `state.json` 可能包含用户个性化数据，修改前需要确认任务确实要求改动它们。
