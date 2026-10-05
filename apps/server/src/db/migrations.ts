import type pg from "pg";

// Migration SQL chạy lần lượt lúc khởi động, mỗi cái đúng một lần (ghi vào bảng schema_migrations).
// Chỉ thêm migration mới vào cuối, không sửa migration đã chạy.

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "001_accounts",
    sql: `
      CREATE TABLE users (
        id            bigserial PRIMARY KEY,
        username      text NOT NULL CHECK (char_length(username) BETWEEN 3 AND 20),
        password_hash text NOT NULL,
        coins         integer NOT NULL DEFAULT 1000 CHECK (coins >= 0),
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      -- Tên đăng nhập không trùng, không phân biệt hoa thường.
      CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

      CREATE TABLE sessions (
        token_hash text PRIMARY KEY,
        user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX sessions_user ON sessions (user_id);

      CREATE TABLE user_skins (
        user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skin_id     text NOT NULL,
        obtained_at timestamptz NOT NULL DEFAULT now(),
        count       integer NOT NULL DEFAULT 1 CHECK (count >= 0),
        PRIMARY KEY (user_id, skin_id)
      );

      CREATE TABLE equipped_skins (
        user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weapon_id text NOT NULL,
        skin_id   text NOT NULL,
        PRIMARY KEY (user_id, weapon_id)
      );

      CREATE TABLE gacha_rolls (
        id        bigserial PRIMARY KEY,
        user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skin_id   text NOT NULL,
        rarity    text NOT NULL,
        cost      integer NOT NULL,
        rolled_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX gacha_rolls_user ON gacha_rolls (user_id, rolled_at);

      CREATE TABLE match_results (
        id           bigserial PRIMARY KEY,
        user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode         text NOT NULL,
        kills        integer NOT NULL DEFAULT 0,
        placement    integer NOT NULL,
        coins_earned integer NOT NULL DEFAULT 0,
        played_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX match_results_user ON match_results (user_id, played_at);
    `,
  },
  {
    id: "002_gacha_pity",
    sql: `
      -- Bộ đếm bảo hiểm gacha: số lượt liền chưa ra sử thi+ / huyền thoại.
      ALTER TABLE users ADD COLUMN pity_epic integer NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN pity_legendary integer NOT NULL DEFAULT 0;
    `,
  },
  {
    id: "003_progression",
    sql: `
      -- Quân hàm: tổng XP (quân hàm suy ra từ XP bằng rankOf), thẻ tên và huy hiệu đang lắp.
      ALTER TABLE users ADD COLUMN xp bigint NOT NULL DEFAULT 0 CHECK (xp >= 0);
      ALTER TABLE users ADD COLUMN calling_card text NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN emblem text NOT NULL DEFAULT '';
      ALTER TABLE match_results ADD COLUMN xp_earned integer NOT NULL DEFAULT 0;

      -- Gunsmith: bộ phụ kiện ưa thích của mỗi khẩu (skin ưa thích vẫn nằm ở equipped_skins).
      CREATE TABLE weapon_loadouts (
        user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weapon_id  text NOT NULL,
        muzzle     text NOT NULL DEFAULT '',
        grip       text NOT NULL DEFAULT '',
        mag        text NOT NULL DEFAULT '',
        stock      text NOT NULL DEFAULT '',
        sight      text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, weapon_id)
      );
    `,
  },
];

/** Khoá tư vấn để hai tiến trình server khởi động cùng lúc không chạy migration hai lần. */
const LOCK_ID = 7_101_010;

/** Chạy các migration chưa chạy, theo thứ tự. Trả về id các migration vừa chạy. */
export async function migrate(pool: pg.Pool, migrations: readonly Migration[] = MIGRATIONS): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
        await client.query("COMMIT");
        applied.push(m.id);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${m.id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}
