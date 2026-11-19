# Paper Reed 图标

原创纸白／苇绿色图标，按仓库 GPL-3.0-only 许可提供。

- `app-icon.svg`：1024 坐标的应用图标源文件。
- `mark.svg`：透明背景的界面标记。
- `app-icon.png` / `paper-reed.icns`：已生成的应用资源。ICNS 包含 16–1024 px 尺寸。

普通构建直接复制已生成资源，不需要浏览器。修改 SVG 后，可在已安装依赖的 Mailspring checkout 上用 macOS 的 `iconutil` 和 Playwright Chromium 重新生成：

```sh
node scripts/build-icon.cjs
```

默认使用 `research/.local/Mailspring` 的 Playwright。可通过第一个参数指定 checkout，或 `PAPER_REED_CHROMIUM` 指定已有 Chromium 可执行文件。没有安装 Playwright 浏览器时，需先在该 checkout 执行 `npx playwright install chromium`。
