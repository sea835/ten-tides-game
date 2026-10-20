import { useEffect, useRef, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { WEAPON, loadoutItemPrice, loadoutItems, lootLabel, validateLoadout } from "@tentides/content";
import { Messages } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { useAccount } from "../../account/account.ts";
import { playBuy } from "../sound/guns.ts";

// Bộ lắp ráp Kho Quân Nhu (Gunsmith) trong cửa hàng: khẩu nào đã lưu bộ phụ kiện thì có thêm nút "Mua theo cấu hình"
// — mua súng rồi từng món của bộ theo giá thường (server đọc bộ đã lưu từ tài khoản, món không đủ tiền hay hàng hiếm
// thì bỏ qua). Lưu bộ mới trong Gunsmith thì báo server đọc lại.

/** Thẻ súng trong cửa hàng, kèm nút mua theo cấu hình nếu khẩu này có bộ đã lưu. */
export function LoadoutBuy({ room, weaponId, money, locked, onBuy, children }: { room: IslandRoom; weaponId: string; money: number; locked: boolean; onBuy: () => void; children: ReactNode }) {
  const account = useAccount();
  const saved = account.status === "user" ? account.profile.loadouts?.[weaponId] : undefined;
  const checked = saved ? validateLoadout(weaponId, saved) : null;
  const parts = checked?.ok ? loadoutItems(checked.loadout) : [];
  if (!parts.length) return <>{children}</>;
  const gunPrice = WEAPON.get(weaponId)?.price ?? 0;
  const total = gunPrice + parts.reduce((n, p) => n + loadoutItemPrice(p), 0);
  const rare = parts.some((p) => !loadoutItemPrice(p));
  return (
    <div className="b-buy-gun">
      {children}
      <button
        className="b-buy-loadout"
        disabled={locked || gunPrice > money}
        onClick={() => {
          onBuy();
          room.send(Messages.battleBuy, { item: weaponId, loadout: true });
          playBuy();
        }}
      >
        <Wrench size={14} aria-hidden />
        <span>
          <strong>Mua theo cấu hình Kho Quân Nhu</strong>
          <small>
            {parts.map(lootLabel).join(" · ")}
            {rare ? " · hàng hiếm không bán thì bỏ qua" : ""}
            {total > money ? " · thiếu tiền thì bỏ bớt món" : ""}
          </small>
        </span>
        <b>{total}$</b>
      </button>
    </div>
  );
}

/** Lưu bộ lắp ráp mới (Gunsmith mở ngay trong phòng): báo server đọc lại từ tài khoản. */
export function useGunsmithSync(room: IslandRoom) {
  const account = useAccount();
  const loadouts = account.status === "user" ? account.profile.loadouts : undefined;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (loadouts) room.send(Messages.gunsmithSync);
  }, [room, loadouts]);
}
