-- ============================================================================
-- 「今日热搜」案例 · 种子数据（seed.sql）
-- ----------------------------------------------------------------------------
-- 目标库 ：CloudBase PostgreSQL 17 / 环境 acknowledge-d9gnqrpy89f1f7d21
-- 执行方式：node scripts/db-apply.js db/seed.sql
--           （等价于 tcb db execute -e <envId> --sql "$(cat db/seed.sql)"）
-- ----------------------------------------------------------------------------
-- 【幂等性说明】重复执行不报错，而且结果完全一致——靠的是「先 DROP 再 CREATE 再 INSERT」：
--   drop table if exists  → 表不存在也不报错，存在就清掉（含数据）
--   create table if not exists → 重新建出干净表
--   insert                 → 重新灌入 18 条热搜 + 6 条收藏
--   所以**跑第二遍和第一遍的结果逐行相同**（id 也会从 1 重新开始）。
--
--   ⚠️ 代价要说清楚：DROP 会删掉这两张表里的**全部**数据，包括不是本脚本插入的行。
--      它只适合演示/重置场景。真实项目里种子脚本不该这么写——参考做法是
--      「只删自己插入的那批（id 带 seed- 前缀）+ UPSERT」，见 README「数据库」节的对比说明。
--
-- 【建表语句为什么在本文件里又写了一遍】
--   案例要求 seed.sql「先 DROP 再 CREATE 再 INSERT」，好让这个文件能单独执行。
--   db/schema.sql 仍是表结构的**权威版本**（带完整字段注释与选型说明），
--   改结构时请改 schema.sql，并同步这里的 create 语句（两处保持一致）。
--
-- 【日期为什么用 current_date 而不是写死日期】
--   页面有「今天的热搜」这类按天算的逻辑，写死日期的话过几天种子数据就"过期"了。
--   用相对日期，任何时候执行，数据都落在「今天 / 昨天」上。
-- ============================================================================


-- ############################################################################
-- 1) 清空：先删带外键的一方（favorites），再删被引用的（trends）
-- ############################################################################
drop table if exists favorites;
drop table if exists trends;


-- ############################################################################
-- 2) 建表：与 db/schema.sql 保持一致
-- ############################################################################
create table trends (
  id         bigserial   primary key,
  title      text        not null,
  heat       bigint,
  platform   text        not null,
  "rank"     smallint    not null check ("rank" >= 1),
  trend_date date        not null,
  fetched_at timestamptz not null default now()
);

-- 唯一索引（来源平台, 标题, 日期）：同一平台同一天的同一条热搜只允许一行
create unique index uq_trends_platform_title_date
  on trends (platform, title, trend_date);

create index idx_trends_date_platform_rank
  on trends (trend_date desc, platform, "rank");

create table favorites (
  id         bigserial   primary key,
  trends_id  bigint      not null
                         references trends(id)
                         on update cascade
                         on delete cascade,
  note       varchar(50),
  created_at timestamptz not null default now()
);

create index idx_favorites_trends_id
  on favorites (trends_id);

create index idx_favorites_created_at
  on favorites (created_at desc);


-- ############################################################################
-- 3) 灌数据：热搜 18 条
--    · 今天 15 条 = 微博 5 + 抖音 5 + B站 5（对齐页面上实际展示的 3 个平台）
--    · 昨天  3 条 = 三个平台各取「今天第 1 条」的同一标题
--      —— 这 3 条不是凑数：它们用来证明唯一索引「含日期」是对的，
--         同平台 + 同标题 + **不同日期** 可以共存（热搜是每日快照，连着两天的标题相同很正常）
--    标题沿用 data/hot.json 的样本文案（保留「样本：」前缀，避免被误当成真实榜单）
-- ############################################################################
insert into trends (title, heat, platform, "rank", trend_date, fetched_at) values
  -- 微博（今天）
  ('样本：全国多地迎来秋分降温，多地气温创新低',   4863210, '微博', 1, current_date, now() - interval '20 minutes'),
  ('样本：新一期贷款市场报价利率公布',             4210553, '微博', 2, current_date, now() - interval '20 minutes'),
  ('样本：国产大飞机新增两条直飞航线',             3988760, '微博', 3, current_date, now() - interval '20 minutes'),
  ('样本：高校食堂推出自助称重计费窗口引热议',     3452118, '微博', 4, current_date, now() - interval '20 minutes'),
  ('样本：中秋假期火车票今日开售',                 3122845, '微博', 5, current_date, now() - interval '20 minutes'),
  -- 抖音（今天）
  ('样本：秋分日全民晒丰收，乡村晒秋太治愈',       5210344, '抖音', 1, current_date, now() - interval '20 minutes'),
  ('样本：大爷用竹编还原老街全景，网友直呼高手',   4765210, '抖音', 2, current_date, now() - interval '20 minutes'),
  ('样本：高校开学典礼硬核无人机灯光秀',           4321876, '抖音', 3, current_date, now() - interval '20 minutes'),
  ('样本：消防员逆行背影感动整条街',               3876543, '抖音', 4, current_date, now() - interval '20 minutes'),
  ('样本：跟着非遗传承人学做传统糕点',             3432109, '抖音', 5, current_date, now() - interval '20 minutes'),
  -- B站（今天）
  ('样本：秋分这一天，我把二十四节气拍成了纪录片',      3120458, 'B站', 1, current_date, now() - interval '20 minutes'),
  ('样本：用一百种方法讲清楚一个物理定律是什么体验',    2876543, 'B站', 2, current_date, now() - interval '20 minutes'),
  ('样本：食堂十五元吃什么？大学生测评第三十期',        2543210, 'B站', 3, current_date, now() - interval '20 minutes'),
  ('样本：一个人的毕业旅行，从高原到海边',              2298765, 'B站', 4, current_date, now() - interval '20 minutes'),
  ('样本：从零开始做一把木椅，手工全过程记录',          2054321, 'B站', 5, current_date, now() - interval '20 minutes'),
  -- 昨天（与今天同标题，靠「日期」区分开 —— 唯一索引含日期，不冲突）
  ('样本：全国多地迎来秋分降温，多地气温创新低',   4600000, '微博', 2, current_date - 1, now() - interval '1 day'),
  ('样本：秋分日全民晒丰收，乡村晒秋太治愈',       4980000, '抖音', 2, current_date - 1, now() - interval '1 day'),
  ('样本：秋分这一天，我把二十四节气拍成了纪录片', 3000000, 'B站', 3, current_date - 1, now() - interval '1 day');


-- ############################################################################
-- 4) 灌数据：收藏 6 条
--    注意这里**不硬编码 trends_id 的数字**（自增 id 每次 DROP 重建后虽然会变回 1，但写死数字太脆）。
--    做法：用 (values ...) 列出「平台 + 标题 + 日期」这个业务坐标，
--         再 join trends 把对应的 id 取出来插进 trends_id —— 业务坐标 → 代理键 的转换由数据库完成，
--         顺带也演示了「收藏引用的是热搜行本身，而不是复制一份标题」。
--    其中最后一条故意不写备注（note 为 NULL），用来验证「备注可以为空」。
-- ############################################################################
insert into favorites (trends_id, note, created_at)
select t.id, v.note, now() - v.ago
from (values
  ('微博', '样本：全国多地迎来秋分降温，多地气温创新低', '降温要加衣服，跟进后续报道',   interval '5 hours'),
  ('微博', '样本：中秋假期火车票今日开售',               '提醒家里抢票',                 interval '4 hours'),
  ('抖音', '样本：大爷用竹编还原老街全景，网友直呼高手',  '手艺太好，想看看完整视频',     interval '3 hours'),
  ('B站',  '样本：秋分这一天，我把二十四节气拍成了纪录片', '周末看，二十分钟应该刚好',     interval '2 hours'),
  ('B站',  '样本：从零开始做一把木椅，手工全过程记录',     '收藏等有空慢慢看',             interval '1 hour'),
  ('抖音', '样本：消防员逆行背影感动整条街',               null,                           interval '30 minutes')
) as v(platform, title, note, ago)
join trends t
  on  t.platform   = v.platform
  and t.title      = v.title
  and t.trend_date = current_date;


-- ############################################################################
-- 5) 自检：跑完直接打出各表行数，与预期对不上就是哪里错了
--    预期：trends 18 行（今天 15 + 昨天 3）｜favorites 6 行
-- ############################################################################
select 'trends(全部)'  as check_item, count(*)::text as result from trends
union all
select 'trends(今天)', count(*)::text from trends where trend_date = current_date
union all
select 'favorites',    count(*)::text from favorites;
