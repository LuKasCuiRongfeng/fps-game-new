这个项目的目标是开发一款大地图的第一人称 3D FPS 末日生存类游戏，有点类似饥荒，但可以有新颖的玩法

编码要求：代码做到低耦合，易维护，易扩展，TSL shader为第一优先级，尽量写shader，尽量写compute shader利用gpu加速计算

高级性能优化：如果需要依赖系统编程语言的性能，可以通过调用 rust 或者用rust 转换从 wasm 供 前端调用 

第三方库：如果需要第三方依赖库，只要能提高性能就放心大胆安装使用

技术：前端 src 目录下，react，tailwindcss，渲染使用three.js，TSL（必须是webgpu） 写shader，后端 src-tauri目录下，使用rust

文件结构：游戏代码放在 src/game 目录下，请注意文件良好的划分，ui放在src/ui目录下

静态资产：放在src-tauri/resources 目录下

rust：如果项目需要用到后端的能力，请用rust在 src-tauri/src目录下编写

要求：代码做到低耦合，易维护，易扩展，尽量写shader。webgpu shader(TSL)是第一个核心，尽可能的用 TSL 写shader，能用shader的地方就尽量用TSL 写shader，能用gpu加速的地方就尽量用 TSL 写compute shader，做到好的性能

服务：对于项目中如果依赖服务的数据，通过项目的server目录下 node index.js启动一个本地服务