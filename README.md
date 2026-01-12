### 项目的目标

开发一款超大地图的第一人称 3D FPS 的末日生存类游戏，有点类似饥荒，但可以有新颖的玩法

### 技术

前端 src 目录下，react，tailwindcss，渲染使用 three.js，TSL（必须是 webgpu） 写 shader，后端 src-tauri 目录下，使用 rust

### 代码要求

代码做到低耦合，易维护，易扩展，TSL shader 为第一优先级，尽量写 shader，尽量写 compute shader 利用 gpu 加速计算

### 高级性能优化

如果需要依赖系统编程语言的性能，可以通过调用 rust 或者用 rust 转换从 wasm 供前端调用

### rust

如果项目需要用到后端的能力，请用 rust 在 src-tauri/src 目录下编写

### 第三方库

如果需要第三方依赖库，只要能提高性能就放心大胆安装使用

### 全部使用新特性，不考虑兼容性

该项目不要考虑任何兼容性，JS，浏览器，three.js，webgpu 都可以使用最新的特性和功能，不要考虑任何兼容性，不要写兼容性代码

### 静态资产

放在 src-tauri/resources 目录下

### 临时本地服务

对于项目中如果依赖服务的数据，通过项目的 server 目录下 node index.js 启动一个本地服务
