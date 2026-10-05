// Mở Gunsmith từ bất cứ đâu (nút ở sảnh, bảng tài khoản): phát sự kiện window "tentides:gunsmith",
// GunsmithHost (gắn ở App) nghe sự kiện này và hiện màn Gunsmith. `weaponId` (tuỳ chọn) là khẩu chọn sẵn.

export const GUNSMITH_EVENT = "tentides:gunsmith";

export interface GunsmithEventDetail {
  weaponId?: string;
}

export function openGunsmith(weaponId?: string): void {
  window.dispatchEvent(new CustomEvent<GunsmithEventDetail>(GUNSMITH_EVENT, { detail: { weaponId } }));
}
