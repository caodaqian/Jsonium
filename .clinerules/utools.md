## utools 介绍

utools 是一个插件化的启动器，支持各个主流平台执行

## API 介绍


### 基础文档
[插件应用目录结构](https://www.u-tools.cn/docs/developer/information/file-structure.html)
一个插件应用应该包含哪些文件，了解插件应用项目的文件目录结构

[plugin.json 配置](https://www.u-tools.cn/docs/developer/information/plugin-json.html)
插件应用基础配置文件 plugin.json 配置说明

[认识 preload](https://www.u-tools.cn/docs/developer/information/preload-js/preload-js.html)
plugin.json 配置的 preload js 文件可以调用 Node.js API 的本地原生能力和 Electron 渲染进程 API

[使用 Node.js](https://www.u-tools.cn/docs/developer/information/preload-js/nodejs.html)
preload js 文件遵循 CommonJS 规范，通过 require 引入 Node.js (16.x 版本) 模块


### API 文档

[事件](https://www.u-tools.cn/docs/developer/api-reference/utools/events.html)
你可以根据需要，事先传递一些回调函数给这些事件，uTools 会在对应事件被触发时调用它们

[窗口](https://www.u-tools.cn/docs/developer/api-reference/utools/window.html)
用来实现一些跟 uTools 窗口相关的功能

[复制](https://www.u-tools.cn/docs/developer/api-reference/utools/copy.html)
执行复制文本、图像、文件(夹)

[输入](https://www.u-tools.cn/docs/developer/api-reference/utools/input.html)
向系统窗口粘贴文本、图片、文件及向系统窗口输入文本

[系统](https://www.u-tools.cn/docs/developer/api-reference/utools/system.html)
弹出通知、打开文件、在资源管理器中显示文件...

[屏幕](https://www.u-tools.cn/docs/developer/api-reference/utools/screen.html)
取色、截图、及获取屏幕信息

[用户](https://www.u-tools.cn/docs/developer/api-reference/utools/user.html)
通过用户接口，可以获取到用户的基本信息、临时 token 等

[动态指令](https://www.u-tools.cn/docs/developer/api-reference/utools/features.html)
动态控制插件应用的功能指令

[模拟按键](https://www.u-tools.cn/docs/developer/api-reference/utools/simulate.html)
模拟用户的键盘与鼠标按键操作

[AI](https://www.u-tools.cn/docs/developer/api-reference/utools/ai.html)
调用 AI 能力，支持 Function Calling

[FFmpeg](https://www.u-tools.cn/docs/developer/api-reference/utools/ffmpeg.html)
FFmpeg 以独立扩展的方式集成到 uTools, 可直接调用 FFmpeg

[本地数据库](https://www.u-tools.cn/docs/developer/api-reference/db/local-db.html)
数据存储(离线优先，支持云备份&同步)

[dbStorage](https://www.u-tools.cn/docs/developer/api-reference/db/db-storage.html)
基于 本地数据库 基础上，封装的一套类 localStorage API

[dbCryptoStorage](https://www.u-tools.cn/docs/developer/api-reference/db/db-crypto-storage.html)
基于 本地数据库 数据加密存储, dbStorage 加密存储版本

[可编程浏览器](https://www.u-tools.cn/docs/developer/api-reference/ubrowser/ubrowser.html)
uTools browser 简称 ubrowser，是根据 uTools 的特性，量身打造的一个可编程浏览器

[ubrowser 管理](https://www.u-tools.cn/docs/developer/api-reference/ubrowser/ubrowser.html)
用于管理 ubrowser 的实例对象，以及设置 ubrowser 的代理对象等

[团队应用](https://www.u-tools.cn/docs/developer/api-reference/team.html)
团队版插件应用相关的接口

[用户付费](https://www.u-tools.cn/docs/developer/api-reference/payment.html)
插件应用接入增值付费

[服务端 API](https://www.u-tools.cn/docs/developer/api-reference/server.html)
服务端使用 uTools 相关的一些接口。