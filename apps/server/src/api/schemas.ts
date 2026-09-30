import { SKIN_WEAPON_IDS } from "@tentides/content";
import { z } from "zod";

// Kiểm tra mọi dữ liệu client gửi lên API tài khoản.

/** Tên đăng nhập 3–20 ký tự: chữ (có dấu tiếng Việt), số, gạch dưới, chấm, gạch ngang. Cũng là tên hiện trong game. */
export const Username = z
  .string()
  .trim()
  .min(3, "Tên đăng nhập phải từ 3 ký tự.")
  .max(20, "Tên đăng nhập tối đa 20 ký tự.")
  .regex(/^[\p{L}\p{N}_.-]+$/u, "Tên chỉ gồm chữ, số, dấu chấm, gạch dưới, gạch ngang.");

export const Password = z.string().min(6, "Mật khẩu phải từ 6 ký tự.").max(128, "Mật khẩu quá dài.");

export const Credentials = z.object({ username: Username, password: Password });
export type Credentials = z.infer<typeof Credentials>;

/** Đăng nhập thì chỉ cần khớp độ dài, để tài khoản cũ không bị chặn nếu sau này đổi luật đặt tên. */
export const LoginBody = z.object({ username: z.string().trim().min(1).max(20), password: z.string().min(1).max(128) });

export const RollBody = z.object({ count: z.union([z.literal(1), z.literal(10)], { error: "Chỉ quay 1 hoặc 10 lượt." }) });

export const EquipBody = z.object({
  weaponId: z.string().refine((w) => SKIN_WEAPON_IDS.includes(w), "Không có khẩu súng này."),
  skinId: z.string().max(64),
});
