# filter-interaction Skill 调用记录

> 本文件是 SKILL.md 第 4 节要求的"调用留痕"。每次真实调用（读全文 → 按清单执行 → 复检）追加一条。

## 2026-09-29 13:50 ｜ 第 1 次调用 ｜ Day 12 主任务

- **触发**：给「今日热搜」榜单新增关键词筛选（课程 Day 12：创建并调用 Skill 完成一次筛选交互）
- **调用方式**：Read `skills/filter-interaction/SKILL.md` 全文 → 按第 1 节先定三态 → 按第 2 节清单逐条实现 → 按第 3 节四步实测
- **实现落点**：index.html 新增筛选条（label+search 输入框+清除按钮+aria-live 计数）；app.js 新增 `applyFilter/clearFilter/updateFilterCount`，`itemsOfPlatform(name, ignoreFilter)` 入口过滤；styles.css 新增 `.filter-bar` 系列
- **执行结果（无头浏览器实测）**：
  - 第 3 节第 1 步 有结果：`?filter=中秋` → 「匹配 1/30 条」，微博 1 条，抖音/B站各显示「没有匹配」文案，清除按钮可用 ✓
  - 第 3 节第 2 步 无结果：`?filter=不存在xyz` → 「匹配 0/30 条」，三栏均有无结果文案而非空白 ✓
  - 第 3 节第 3 步 清空恢复：输入「中秋」（30→1 行）→ 点「清除筛选」→ 30 行逐条复原、计数清空、按钮回禁用、焦点回输入框 ✓
  - 第 3 节第 4 步 回归：收藏/详情/抽屉、`?state=` 预览不受影响 ✓
- **交付截图**：`打卡/状态截图/Day12-筛选有结果.png`、`打卡/状态截图/Day12-SKILL文件.png`（均含地址栏）
- **结论**：Skill 清单 8 项全部落实，三态测试通过，本次调用有效。
