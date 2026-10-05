// Kho Quân Nhu (Gunsmith): sảnh chỉ phát sự kiện, màn tháo lắp súng nghe sự kiện này rồi tự mở.

export const GUNSMITH_EVENT = "tentides:gunsmith";

/** Mở Kho Quân Nhu: phát CustomEvent "tentides:gunsmith" trên window. */
export function openGunsmith(): void {
  window.dispatchEvent(new CustomEvent(GUNSMITH_EVENT));
}
