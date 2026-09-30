import pg from "pg";
import { migrate } from "./migrations.ts";

// Kết nối PostgreSQL cho tài khoản, kho skin, gacha. Không đặt DATABASE_URL thì tắt hẳn tài khoản:
// game vẫn chạy bình thường cho khách, mọi API tài khoản trả lỗi "accounts_disabled".

let pool: pg.Pool | null = null;
let ready = false;

/** Tài khoản đang bật (đã có database và chạy xong migration). */
export function accountsEnabled(): boolean {
  return ready && pool !== null;
}

/** Pool đã sẵn sàng. Chỉ gọi khi accountsEnabled() là true. */
export function db(): pg.Pool {
  if (!pool || !ready) throw new Error("accounts_disabled");
  return pool;
}

/**
 * Mở pool từ DATABASE_URL và chạy migration. Lỗi (sai mật khẩu, database chưa chạy) thì chỉ in cảnh báo
 * và tắt tài khoản, server vẫn lên cho khách chơi.
 */
export async function initDb(url = process.env.DATABASE_URL): Promise<boolean> {
  if (!url) {
    console.log("Chưa đặt DATABASE_URL: tắt tài khoản, chỉ chơi khách.");
    return false;
  }
  const p = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  // Lỗi của kết nối rảnh (database khởi động lại...) không được làm sập cả server.
  p.on("error", (err) => console.warn("PostgreSQL:", err.message));
  try {
    const applied = await migrate(p);
    if (applied.length) console.log(`Đã chạy migration: ${applied.join(", ")}`);
    pool = p;
    ready = true;
    console.log("Tài khoản: đã kết nối PostgreSQL.");
    return true;
  } catch (err) {
    console.warn("Không kết nối được PostgreSQL, tắt tài khoản:", err instanceof Error ? err.message : err);
    await p.end().catch(() => {});
    return false;
  }
}

export async function closeDb() {
  const p = pool;
  pool = null;
  ready = false;
  await p?.end();
}

/** Chạy một đoạn trong transaction; lỗi thì rollback rồi ném lại. */
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
