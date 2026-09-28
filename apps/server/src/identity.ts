import { createHash } from "node:crypto";

/**
 * Id công khai của người chơi, suy ra một chiều từ token bí mật lưu ở trình duyệt.
 * Ai biết id (ai cũng thấy trong state) cũng không suy ngược ra token để giả làm người đó.
 */
export function playerIdFromToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}
