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

## 2026-09-29 14:05 ｜ 第 2 次调用 ｜ Day 12 续（关键词 + 平台双维度）

- **触发**：给「今日热搜」再增加平台筛选，要求与关键词组合生效、空态文案统一为「没有找到相关内容」、清空后恢复完整列表
- **调用方式**：Read `skills/filter-interaction/SKILL.md` 全文（v1）→ 按第 1 节定三态 → 按第 2 节清单实现 → 按第 3 节实测 → 发现 v1 未覆盖"分类维度"与"组合空态"，**当场把 Skill 升级到 v2** 再复测
- **实现落点**：index.html 新增平台筛选条（`#platform-chips`）；app.js 新增 `filterPlatform`/`activePlatforms()`/`filterDesc()`/`renderPlatformChips()`/`syncPlatformChips()`/`setPlatform()`/`refreshFilterUI()`，`renderBoard()` 改为按当前平台渲染并加 `.board--single`；styles.css 新增 `.chip` 系列与 `.board--single`
- **执行结果（无头浏览器实测）**：
  - 第 3 节 1 有结果（关键词）：`中秋` → 3 栏、匹配 1/30、另两栏显示空态 ✓
  - 第 3 节 2 有结果（平台）：点「微博」→ 1 栏（微博 10 条）、匹配 10/10、`gridCols=620px`、选中态 `aria-pressed=true` ✓
  - 第 3 节 3 组合：微博 + `中秋` → 1 条，匹配 1/10 ✓
  - 第 3 节 4 无结果（组合）：微博 + `不存在xyz` → 主文案「没有找到相关内容」、副文案带「关键词「不存在xyz」 + 平台「微博」」、匹配 0/10 ✓
  - 第 3 节 5 清空恢复：3 栏 30 行复原、chips 回「全部」、清除按钮禁用、焦点回输入框 ✓
  - 第 3 节 6 回归：收藏状态机（忙碌→已收藏，计数 1）、详情弹层、`?state=` 正常 ✓
  - 第 3 节 7 两档宽度：360px 无溢出（scrollWidth 345/360）、chips 单行 4 个各 40px 高；1440px 与改动前一致 ✓
- **交付截图**：`打卡/状态截图/Day12续-平台筛选有结果.png`、`Day12续-筛选无结果.png`、`Day12续-清空恢复.png`（均含地址栏）
- **结论**：Skill 升级到 v2 后清单 15 项全部落实，三态 + 组合态 + 两档宽度测试通过，本次调用有效。
