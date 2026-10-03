-- MySQL 9.7 LTS：在独立测试数据库的新连接中运行。
-- 临时表仅属于当前连接，断开连接后自动释放。
CREATE TEMPORARY TABLE article_keyset_demo (
    id BIGINT NOT NULL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX idx_status_created_id (status, created_at DESC, id DESC)
) ENGINE = InnoDB;

INSERT INTO article_keyset_demo (id, title, status, created_at) VALUES
    (7, 'draft-7', 'DRAFT',     '2026-09-09 09:00:00.000000'),
    (6, 'post-6',  'PUBLISHED', '2026-09-09 08:00:00.000001'),
    (5, 'post-5',  'PUBLISHED', '2026-09-09 08:00:00.000001'),
    (4, 'post-4',  'PUBLISHED', '2026-09-09 08:00:00.000000'),
    (3, 'post-3',  'PUBLISHED', '2026-09-09 07:59:59.999999'),
    (2, 'post-2',  'PUBLISHED', '2026-09-09 07:59:59.999999');

-- 第一页按固定数据推导应返回 ID 6、5。
SELECT id, title, created_at
FROM article_keyset_demo
WHERE status = 'PUBLISHED'
ORDER BY created_at DESC, id DESC
LIMIT 2;

-- 使用第一页最后一条记录的时间和 ID 作为完整游标。
SET @cursor_time = CAST('2026-09-09 08:00:00.000001' AS DATETIME(6));
SET @cursor_id = 5;

-- 第二页按固定数据推导应返回 ID 4、3。
SELECT id, title, created_at
FROM article_keyset_demo
WHERE status = 'PUBLISHED'
  AND (created_at < @cursor_time
       OR (created_at = @cursor_time AND id < @cursor_id))
ORDER BY created_at DESC, id DESC
LIMIT 2;

-- 使用第二页最后一条记录的时间和 ID 作为完整游标。
SET @cursor_time = CAST('2026-09-09 07:59:59.999999' AS DATETIME(6));
SET @cursor_id = 3;

-- 第三页应返回 ID 2，它与 ID 3 的创建时间相同。
SELECT id, title, created_at
FROM article_keyset_demo
WHERE status = 'PUBLISHED'
  AND (created_at < @cursor_time
       OR (created_at = @cursor_time AND id < @cursor_id))
ORDER BY created_at DESC, id DESC
LIMIT 2;

-- 错误对照：只传时间会遗漏 ID 2，此查询返回空结果。
SELECT id, title, created_at
FROM article_keyset_demo
WHERE status = 'PUBLISHED' AND created_at < @cursor_time
ORDER BY created_at DESC, id DESC
LIMIT 2;
