-- ============================================================================
-- 「今日热搜」案例 · 数据库表结构（schema.sql）
-- ----------------------------------------------------------------------------
-- 目标库 ：CloudBase PostgreSQL 17
--          环境 acknowledge-d9gnqrpy89f1f7d21（上海 ap-shanghai，体验版）
-- 设计依据：本案例的数据对象定义见 TECH_DESIGN.md 第 5 章
-- 执行方式（命令行）：node scripts/db-apply.js db/schema.sql
-- 执行方式（控制台）：CloudBase 控制台 → 该环境 → 数据库 → SQL 编辑区，
--                     粘贴本文件内容 → 执行（步骤见 README「数据库」节）
-- 幂等性 ：全部 create ... if not exists —— 重复执行不报错、不丢已有数据
-- ----------------------------------------------------------------------------
-- ⚠️ 说明：这两张表是**案例演示表**，只用于跑通「建表 → 灌种子 → select 验证」这条链路，
--    不代表任何真实项目的生产设计（真实项目请按自己的页面需求推导表结构）。
-- ----------------------------------------------------------------------------
-- 【今天要掌握的两个问题】
--
-- 1) 两张表分别存什么？
--    · trends    —— 热搜条目：某个平台在某一天榜单上的第 N 条，标题 + 热度是多少。
--                   一次抓取就是一批行，所以它天然带「日期」维度，是**每日一份的快照**。
--    · favorites —— 收藏：用户把哪一条热搜收进了自己的列表，以及给它写了什么备注。
--
-- 2) 它们靠哪个字段关联？
--    · favorites.trends_id → trends.id（外键）
--    收藏存的不是「标题副本」，而是一个指向热搜行的引用。
--    这样标题改了、热度变了，收藏那里不需要同步改（不会出现两份不一致的标题）。
--    这也正是本案例唯一索引建在 trends 上、而不是在 favorites 重复存标题的原因。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 表 1｜trends —— 热搜条目（每日每平台一份快照）
-- ----------------------------------------------------------------------------
create table if not exists trends (
  id         bigserial   primary key,                       -- 主键，自增
  title      text        not null,                          -- 标题
  heat       bigint,                                        -- 热度（可为空：上游没给就存 NULL）
  platform   text        not null,                          -- 来源平台
  "rank"     smallint    not null check ("rank" >= 1),      -- 榜单排名，从 1 开始
  trend_date date        not null,                          -- 榜单所属日期（业务日期）
  fetched_at timestamptz not null default now()             -- 抓取时间（入库时刻）
);

comment on table  trends            is '热搜条目（案例演示表）：某平台某天榜单上的一条热搜。一次抓取写入一批行，因此按「平台 + 日期」天然分批';
comment on column trends.id         is '主键，bigserial 自增。为什么用自增数字而不是拿「平台+标题+日期」当主键：那三列是唯一性判据但太长，被 favorites 引用时外键要背三列很笨拙；改用代理键（surrogate key），唯一性交给下面的唯一索引来管';
comment on column trends.title      is '热搜标题，text 不限长度。标题长短不一，截断显示是前端的事（TECH_DESIGN 5.1：后端不截断），数据库更不该在人造长度上把内容截掉';
comment on column trends.heat       is '热度值，bigint。热度是纯数字，用数字类型才能比较大小（例如「今天最热的一条」）；可为空 —— 上游没给热度时存 NULL 而不是 0，因为 0 会显示成「热度 0」（TECH_DESIGN 5.1：不显示 0）。若上游给的是「1.2万」这类非纯数字，需在云函数里先归一化成整数再入库';
comment on column trends.platform   is '来源平台，如 微博 / 抖音 / B站。用 text 且不加长度上限、不加 CHECK 枚举：平台清单还在变（PRD 曾列 4 个，当前线上展示 3 个），约束写太死会导致新增平台插入失败';
comment on column trends."rank"     is '榜单内排名，从 1 开始。smallint 够用（榜单最多几十条，上限 32767）+ check(rank >= 1) 挡住 0 和负数这类明显错误，把规则交给数据库兜底';
comment on column trends.trend_date is '榜单所属日期，date 类型（只到天）。用 date 而不是 timestamp：判断「这是不是今天的热搜」不应该受抓取时刻的时分秒影响；date 还能直接和 current_date 比较';
comment on column trends.fetched_at is '抓取时间（这一行是什么时候写进来的），timestamptz 带时区。与 trend_date 的分工：trend_date 答「属于哪一天的榜单」，fetched_at 答「什么时候抓的」，同一天多次抓取可以对比出更新';


-- ----------------------------------------------------------------------------
-- 表 2｜favorites —— 收藏
-- ----------------------------------------------------------------------------
create table if not exists favorites (
  id         bigserial   primary key,                       -- 主键，自增
  trends_id  bigint      not null
                         references trends(id)              -- ← 关联字段：指向 trends.id
                         on update cascade
                         on delete cascade,
  note       varchar(50),                                   -- 备注，可空
  created_at timestamptz not null default now()             -- 创建时间
);

comment on table  favorites            is '收藏（案例演示表）：用户把哪条热搜收进了列表。存的是指向 trends 的引用，不复制标题';
comment on column favorites.id         is '主键，bigserial 自增。收藏本身没有天然唯一的业务字段（同一人同一条可以取消再收藏），所以用小而稳的代理键';
comment on column favorites.trends_id  is '关联字段：指向 trends.id（外键）。为什么用外键：收藏的对象必须是真实存在的热搜行，数据库层面挡住「收藏一个不存在的东西」。on delete cascade：热搜快照被清理（重灌种子、按日期清库）时，指向它的收藏一并删除，不留孤儿行';
comment on column favorites.note       is '用户备注，可空（收藏时可以先不写）。用 varchar(50) 而不是 text：备注有明确的产品上限「≤50 字」（TECH_DESIGN 5.4 / PRD 6.2），长度限制写在数据库上，接口层漏校验也兜得住';
comment on column favorites.created_at is '收藏时间，timestamptz default now()。收藏列表按它倒序展示（TECH_DESIGN 5.4 saved_at），所以下面给它建了索引';


-- ----------------------------------------------------------------------------
-- 索引 —— 只加「唯一性要求」和「真实查询会用的」，不提前造索引
-- ----------------------------------------------------------------------------
-- ① 本案例明确要求的唯一索引：（来源平台, 标题, 日期）
--    含义：同一个平台、同一个标题、同一天，只能有一行。
--    为什么把「日期」也放进来：热搜是每日快照，同一条新闻连着两天上榜是正常现象，
--    只有「同一天」才需要去重。三次 seed 重复执行 / 重复抓取都靠它兜底。
create unique index if not exists uq_trends_platform_title_date
  on trends (platform, title, trend_date);

-- ② 列表查询用：按日期取某天的榜单，再按平台、排名排（首页每列的顺序）
create index if not exists idx_trends_date_platform_rank
  on trends (trend_date desc, platform, "rank");

-- ③ 外键不会自动建索引，而「这条热搜被收藏了几次」和级联删除都要按 trends_id 查
create index if not exists idx_favorites_trends_id
  on favorites (trends_id);

-- ④ 收藏列表按时间倒序
create index if not exists idx_favorites_created_at
  on favorites (created_at desc);


-- ============================================================================
-- 字段类型选型说明（余力加练：为什么这么选）
-- ----------------------------------------------------------------------------
-- | 字段 | 类型 | 为什么 |
-- | --- | --- | --- |
-- | trends.id / favorites.id | bigserial | 只需要「唯一且稳定」，不需要人工指定。自增整数占用最小、做外键最快；业务唯一性另有唯一索引负责 |
-- | trends.title | text | 标题长短不定。PostgreSQL 里 text 与 varchar(n) 性能相同，但不设人造上限，避免「标题太长插不进去」 |
-- | trends.heat | bigint | 热度是数字，要能比较大小/排序。bigint 覆盖到百亿级，热搜热度（千万量级）绰绰有余；可空，缺失存 NULL 不存 0 |
-- | trends.platform | text | 平台名是短文本且清单会变，不设长度上限也不写 CHECK 枚举，新增平台不用改表 |
-- | trends."rank" | smallint + check | 排名范围极小（1–N），smallint 比 int 省一半空间；check(rank >= 1) 顺手挡住 0/负数 |
-- | trends.trend_date | date | 业务只关心「哪一天」。用 date 而非 timestamp：判重（唯一索引）和「今天」筛选都不会被时分秒干扰 |
-- | trends.fetched_at | timestamptz | 记录时间点。timestamptz 带时区，服务器/导出换时区也不会把历史时间解释错 |
-- | favorites.trends_id | bigint + references | 类型必须与被引用的 trends.id 完全一致（bigint），否则外键建不起来 |
-- | favorites.note | varchar(50) 可空 | 备注有明确 50 字上限，让数据库兜底；可空表示「只收藏不写备注」是合法状态 |
-- | favorites.created_at | timestamptz default now() | 让数据库填时间，不依赖调用方传值，避免时区/格式混乱 |
--
-- 未列入本案例表结构的字段：热搜原文链接 url。案例只需登记「榜单条目 + 收藏关系」，
-- 故按案例给定的字段清单执行；真实项目需要它时，加一列 url text not null 即可（不影响现有结构）。
-- ============================================================================
