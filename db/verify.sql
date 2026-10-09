-- ============================================================================
-- 「今日热搜」案例 · select 验证脚本（verify.sql）
-- ----------------------------------------------------------------------------
-- 用法：node scripts/db-snapshot.js
--       该脚本会按下面的 `-- @panel 英文名 | 标题` 把本文件切成若干面板，
--       逐条执行、打印结果，并生成一张可截图留证的取证页（打卡/db-snapshot.html）。
--
-- 分成两部分：
--   A. 结构验证 —— 表建出来了吗？字段类型/主键/外键/唯一索引对不对？
--   B. 数据验证 —— 每张核心表至少 5 行，业务口径对不对？
-- ============================================================================


-- @panel columns | 结构①｜字段与类型
-- 看什么：两张表的字段名、类型、是否可空、默认值，与 db/schema.sql 的选型说明逐条对上
select table_name,
       ordinal_position  as pos,
       column_name,
       data_type,
       is_nullable,
       coalesce(column_default, '') as col_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('trends', 'favorites')
order by table_name, ordinal_position;


-- @panel constraints | 结构②｜主键 / 外键 / 唯一 / CHECK（完整定义）
-- 看什么：trends 主键、favorites.trends_id 的外键指向 trends 且带 ON DELETE CASCADE、
--         rank 上的 CHECK (rank >= 1)
-- 用 pg_get_constraintdef 而不是 information_schema：后者拿不到 CHECK 的表达式，
-- 也不会把外键的 ON DELETE 规则一起打出来
select c.relname                                        as table_name,
       case con.contype when 'p' then 'PRIMARY KEY'
                        when 'f' then 'FOREIGN KEY'
                        when 'u' then 'UNIQUE'
                        when 'c' then 'CHECK' end       as constraint_type,
       con.conname                                      as constraint_name,
       pg_get_constraintdef(con.oid)                    as definition
from pg_constraint con
join pg_class     c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('trends', 'favorites')
order by c.relname, con.contype;


-- @panel indexes | 结构③｜索引（含案例要求的唯一索引）
-- 看什么：uq_trends_platform_title_date 建在 (platform, title, trend_date) 三列上且是 UNIQUE
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('trends', 'favorites')
order by tablename, indexname;


-- @panel trends | 表 1｜trends（今日热搜条目）
select id, title, heat, platform, "rank", trend_date, fetched_at
from trends
where trend_date = current_date
order by platform, "rank";


-- @panel favorites | 表 2｜favorites（收藏，已关联回热搜原文）
-- 用 join 把 trends_id 翻译成平台 + 标题，直观看出「收藏引用的是哪条热搜」
select f.id, f.trends_id, t.platform, t.title, f.note, f.created_at
from favorites f
join trends t on t.id = f.trends_id
order by f.created_at desc;


-- @panel checks | 数据自检｜行数、平台分布、关联完整性
select '① trends 今日条数（预期 15）'            as check_item, count(*)::text as result
  from trends where trend_date = current_date
union all
select '② trends 全部条数（预期 18）', count(*)::text
  from trends
union all
select '③ favorites 条数（预期 6）', count(*)::text
  from favorites
union all
select '④ 今日各平台条数 微博/抖音/B站（预期 5 / 5 / 5）',
       (select count(*) from trends where trend_date = current_date and platform = '微博')::text || ' / ' ||
       (select count(*) from trends where trend_date = current_date and platform = '抖音')::text || ' / ' ||
       (select count(*) from trends where trend_date = current_date and platform = 'B站')::text
union all
select '⑤ 昨天条数（预期 3：同标题不同日期可共存）', count(*)::text
  from trends where trend_date < current_date
union all
select '⑥ 收藏中关联不到热搜的行（预期 0：外键在管）', count(*)::text
  from favorites f left join trends t on t.id = f.trends_id where t.id is null
union all
select '⑦ 无备注的收藏（预期 1：note 允许为空）', count(*)::text
  from favorites where note is null;
