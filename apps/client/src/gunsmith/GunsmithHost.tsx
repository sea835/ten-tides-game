import { Suspense, lazy, useEffect, useState } from "react";
import { GUNSMITH_EVENT, type GunsmithEventDetail } from "./openGunsmith.ts";

// Nghe sự kiện mở Gunsmith (openGunsmith) và hiện màn Gunsmith. Màn này có Canvas 3D riêng nên nạp lười.

const GunsmithScreen = lazy(() => import("./GunsmithScreen.tsx").then((m) => ({ default: m.GunsmithScreen })));

export function GunsmithHost() {
  const [open, setOpen] = useState<{ weaponId?: string } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setOpen({ weaponId: (e as CustomEvent<GunsmithEventDetail | undefined>).detail?.weaponId });
    window.addEventListener(GUNSMITH_EVENT, onOpen);
    return () => window.removeEventListener(GUNSMITH_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <GunsmithScreen initialWeapon={open.weaponId} onClose={() => setOpen(null)} />
    </Suspense>
  );
}
