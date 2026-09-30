import { useSyncExternalStore } from "react";
import { DEFAULT_SERVER_PORT } from "@tentides/protocol";
import type { SkinRarity } from "@tentides/content";

// Tài khoản phía client: gọi API HTTP của server (chung cổng với Colyseus), giữ phiên đăng nhập trong localStorage
// (khác token khách: token khách theo tab, phiên đăng nhập giữ qua các lần mở trình duyệt), và một store nhỏ cho React.

/** Địa chỉ HTTP của server: cùng máy, cùng cổng với Colyseus (xem SERVER_URL trong net.ts). */
function apiBase(): string {
  const ws: string | undefined = import.meta.env.VITE_SERVER_URL;
  if (ws) return ws.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
  return `${location.protocol === "https:" ? "https" : "http"}://${location.hostname}:${DEFAULT_SERVER_PORT}`;
}

const SESSION_KEY = "tentides.session";

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(token: string | null) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Không lưu được (chế độ riêng tư...) thì phiên chỉ sống tới khi đóng tab.
  }
}

let memorySession: string | null = readSession();

/** Phiên đăng nhập hiện tại, gửi kèm khi vào phòng (join options `session`). */
export function sessionToken(): string | undefined {
  return memorySession ?? undefined;
}

// ---------------------------------------------------------------------------- gọi API

export interface PublicUser {
  id: number;
  username: string;
  coins: number;
}

export interface Profile {
  user: PublicUser;
  skins: { skinId: string; count: number }[];
  equipped: Record<string, string>;
  pity: { sinceEpic: number; sinceLegendary: number };
}

export interface RollOutcome {
  results: { skinId: string; rarity: SkinRarity; count: number; isNew: boolean }[];
  coins: number;
  pity: { sinceEpic: number; sinceLegendary: number };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (memorySession) headers.Authorization = `Bearer ${memorySession}`;
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("network", 0, "Không kết nối được tới server. Server đã chạy chưa?");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(data.error ?? "error", res.status, data.message ?? `Lỗi ${res.status}`);
  return data as T;
}

// ---------------------------------------------------------------------------- store

export type AccountState =
  | { status: "loading" }
  /** Server không bật tài khoản (chưa có database) hoặc không tới được server: ẩn bảng đăng nhập. */
  | { status: "disabled" }
  | { status: "guest" }
  | { status: "user"; profile: Profile };

let state: AccountState = { status: "loading" };
const listeners = new Set<() => void>();

function set(next: AccountState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribe, () => state);
}

function setSession(token: string | null) {
  memorySession = token;
  writeSession(token);
}

let started = false;
/** Hỏi server có bật tài khoản không, có phiên cũ thì nạp hồ sơ. Gọi lại sau đó thì chỉ nạp lại hồ sơ. */
export function initAccount() {
  if (started) {
    // Quay về sảnh sau một trận: nạp lại xu vừa được thưởng.
    if (state.status === "user") void refreshProfile();
    return;
  }
  started = true;
  void (async () => {
    try {
      const { accounts } = await api<{ accounts: boolean }>("GET", "/api/status");
      if (!accounts) return set({ status: "disabled" });
    } catch {
      started = false; // lần sau vào sảnh thử lại
      return set({ status: "disabled" });
    }
    if (!memorySession) return set({ status: "guest" });
    await refreshProfile();
  })();
}

/** Nạp lại hồ sơ (xu, kho skin). Phiên hết hạn thì về khách. */
export async function refreshProfile(): Promise<void> {
  if (!memorySession) return set({ status: "guest" });
  try {
    set({ status: "user", profile: await api<Profile>("GET", "/api/me") });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setSession(null);
      set({ status: "guest" });
    } else if (state.status === "loading") set({ status: "guest" });
  }
}

export async function login(username: string, password: string): Promise<void> {
  const { token } = await api<{ token: string; user: PublicUser }>("POST", "/api/login", { username, password });
  setSession(token);
  await refreshProfile();
}

export async function register(username: string, password: string): Promise<void> {
  const { token } = await api<{ token: string; user: PublicUser }>("POST", "/api/register", { username, password });
  setSession(token);
  await refreshProfile();
}

export async function logout(): Promise<void> {
  try {
    await api("POST", "/api/logout");
  } catch {
    // Server không trả lời thì vẫn xoá phiên ở máy mình.
  }
  setSession(null);
  set({ status: "guest" });
}

export async function rollGacha(count: 1 | 10): Promise<RollOutcome> {
  const out = await api<RollOutcome>("POST", "/api/gacha/roll", { count });
  // Cập nhật xu ngay, kho skin nạp lại ở nền.
  if (state.status === "user") set({ status: "user", profile: { ...state.profile, user: { ...state.profile.user, coins: out.coins }, pity: out.pity } });
  void refreshProfile();
  return out;
}

export async function equipSkin(weaponId: string, skinId: string): Promise<void> {
  const { equipped } = await api<{ equipped: Record<string, string> }>("POST", "/api/skins/equip", { weaponId, skinId });
  if (state.status === "user") set({ status: "user", profile: { ...state.profile, equipped } });
}
