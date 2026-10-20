import { useSyncExternalStore } from "react";
import { DEFAULT_SERVER_PORT } from "@tentides/protocol";
import type { SkinRarity, WeaponLoadout } from "@tentides/content";
import type { PublicRoomInfo, QuickMode } from "@tentides/protocol";

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
  /** Mảnh skin (server cũ chưa có thì thiếu). */
  shards?: number;
  /** Quân hàm (server cũ chưa có thì thiếu). */
  progress?: Progress;
  /** Gunsmith: bộ phụ kiện ưa thích theo khẩu. */
  loadouts?: Record<string, WeaponLoadout>;
}

export interface Progress {
  xp: number;
  rank: number;
  card: string;
  emblem: string;
}

export interface RollOutcome {
  /** `shards`: mảnh lượt này ra (skin trùng), 0 nếu là skin mới. */
  results: { skinId: string; rarity: SkinRarity; count: number; isNew: boolean; shards?: number }[];
  coins: number;
  pity: { sinceEpic: number; sinceLegendary: number };
  shards?: number;
}

export interface ChallengeView {
  id: string;
  title: string;
  stat: string;
  target: number;
  progress: number;
  coins: number;
  xp: number;
  claimed: boolean;
}

export interface ChallengeSet {
  period: "daily" | "weekly";
  key: string;
  /** Lúc kỳ này kết thúc (ms, UTC). */
  endsAt: number;
  items: ChallengeView[];
}

export interface ChallengeStatus {
  daily: ChallengeSet;
  weekly: ChallengeSet;
  coins: { today: number; cap: number };
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
  if (state.status === "user") set({ status: "user", profile: { ...state.profile, user: { ...state.profile.user, coins: out.coins }, pity: out.pity, shards: out.shards ?? state.profile.shards } });
  void refreshProfile();
  return out;
}

/** Đổi mảnh lấy một skin chưa có. */
export async function craftSkin(skinId: string): Promise<void> {
  const out = await api<{ skinId: string; shards: number }>("POST", "/api/gacha/craft", { skinId });
  if (state.status === "user") set({ status: "user", profile: { ...state.profile, shards: out.shards } });
  await refreshProfile();
}

/** Thử thách ngày, tuần và xu trận đã nhận hôm nay (thử thách xong tự nhận thưởng ở server). */
export function fetchChallenges(): Promise<ChallengeStatus> {
  return api<ChallengeStatus>("GET", "/api/challenges");
}

/** Phòng công khai đang mở (không cần đăng nhập). */
export async function fetchPublicRooms(): Promise<PublicRoomInfo[]> {
  return (await api<{ rooms: PublicRoomInfo[] }>("GET", "/api/rooms")).rooms;
}

/** Chơi nhanh: mã phòng công khai nên vào, hay null nếu chưa có phòng hợp (tạo phòng mới). */
export async function fetchQuickRoom(mode: QuickMode): Promise<string | null> {
  return (await api<{ code: string | null }>("GET", `/api/quickplay?mode=${mode}`)).code;
}

export async function equipSkin(weaponId: string, skinId: string): Promise<void> {
  const { equipped } = await api<{ equipped: Record<string, string> }>("POST", "/api/skins/equip", { weaponId, skinId });
  if (state.status === "user") set({ status: "user", profile: { ...state.profile, equipped } });
}

/** Lắp thẻ tên và huy hiệu (rỗng là bỏ). */
export async function equipCard(cardId: string, emblemId: string): Promise<void> {
  const { progress } = await api<{ progress: Progress }>("POST", "/api/profile/card", { cardId, emblemId });
  if (state.status === "user") set({ status: "user", profile: { ...state.profile, progress } });
}

/** Gunsmith: lưu bộ phụ kiện của một khẩu, kèm skin ưa thích (undefined là không đổi skin). */
export async function saveLoadout(weaponId: string, loadout: WeaponLoadout, skinId?: string): Promise<void> {
  const out = await api<{ loadouts: Record<string, WeaponLoadout>; equipped: Record<string, string> }>("POST", "/api/gunsmith/save", { weaponId, loadout, skinId });
  if (state.status === "user") set({ status: "user", profile: { ...state.profile, loadouts: out.loadouts, equipped: out.equipped } });
}
