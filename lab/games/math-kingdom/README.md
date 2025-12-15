# Math Kingdom (数学王国)

一款面向小学 1–6 年级的教育游戏，旨在通过沉浸式冒险让孩子爱上数学。

## 启动项目

1. 进入目录：`cd lab/games/chinese-legend/ai-games/math-kingdom`
2. 安装依赖：`npm install`
3. 启动开发服务器：`npm run dev`

## MVP 内容 (1 年级 - 数字森林)

目前包含以下内容：
- **捡果子**：数字认识与排序
- **河流搭桥**：10 以内加减法
- **形状积木屋**：基础几何形状
- **四季分类**：简单分类与整点时间
- **无限挑战**：综合测试与排行榜

## 架构说明

- **Tech Stack**: React + TypeScript + Vite
- **State Management**: React Context / Zustand (TBD)
- **Styling**: CSS Variables (`src/styles/theme.css`) + CSS Modules
- **Routing**: React Router (`src/app/router.ts`)

## 如何添加新年级

1. 在 `src/data/` 下创建新目录 (如 `grade2`) 并添加 `tasks.json`。
2. 在 `src/game/scenes/` 创建对应的场景组件 (如 `Grade2Village.tsx`)。
3. 在 `src/app/router.ts` 添加路由。
4. 在 `src/game/scenes/IslandSelect.tsx` 中解锁对应岛屿。
