import { forwardRef, useMemo } from "react";
import { BoxGeometry, CapsuleGeometry, MeshStandardMaterial, SphereGeometry, type Group } from "three";
import { withRim } from "../character/rim.ts";

// Người ở xa (hàng chục mét): thay nhân vật đầy đủ (gần trăm khối, bóng đổ, xương khớp chạy mỗi khung hình) bằng một
// hình người gọn vài khối, cùng màu áo ngụy trang, đúng tư thế đứng / ngồi xổm / nằm. Ở xa mắt không phân biệt được,
// còn máy thì nhẹ hẳn khi có 50 máy trên bản đồ.

const OUTFIT_COLOR: Record<string, string> = {
  woodland: "#4c5a36",
  desert: "#b59a6a",
  urban: "#6b6e70",
  digital: "#5d6a6f",
  snow: "#d8dcde",
  ghillie: "#56642f",
};

const G = {
  body: new CapsuleGeometry(0.2, 0.6, 3, 8),
  head: new SphereGeometry(0.13, 8, 6),
  leg: new BoxGeometry(0.14, 0.82, 0.16),
  gun: new BoxGeometry(0.06, 0.1, 0.8),
  band: new BoxGeometry(0.46, 0.12, 0.34),
};
G.leg.translate(0, -0.41, 0);

const mats = new Map<string, MeshStandardMaterial>();
function mat(color: string): MeshStandardMaterial {
  let m = mats.get(color);
  if (!m) {
    m = withRim(new MeshStandardMaterial({ color, roughness: 0.9 }));
    m.userData.detail = "none";
    mats.set(color, m);
  }
  return m;
}
const skin = mat("#c79a78");
const metal = mat("#222325");

/** Hình người rút gọn. `pose`: stand, crouch, prone. Gốc ở chân, mặt nhìn theo +z. */
export const FarSoldier = forwardRef<Group, { outfit: string; pose: "stand" | "crouch" | "prone"; gun: boolean; band?: string }>(function FarSoldier({ outfit, pose, gun, band }, ref) {
  const cloth = useMemo(() => mat(OUTFIT_COLOR[outfit] ?? OUTFIT_COLOR.woodland!), [outfit]);
  const prone = pose === "prone";
  const crouch = pose === "crouch";
  // Nằm: cả khối xoay nằm ngang, dời ra sau cho hông ở chỗ đứng.
  return (
    <group ref={ref}>
      <group rotation-x={prone ? 1.45 : 0} position={[0, prone ? 0.15 : crouch ? -0.4 : 0, prone ? -0.9 : 0]}>
        <mesh geometry={G.leg} material={cloth} position={[0.1, crouch ? 0.7 : 0.9, crouch ? 0.15 : 0]} rotation-x={crouch ? -0.9 : 0} />
        <mesh geometry={G.leg} material={cloth} position={[-0.1, crouch ? 0.7 : 0.9, 0]} />
        <mesh geometry={G.body} material={cloth} position={[0, 1.3, 0]} />
        <mesh geometry={G.head} material={skin} position={[0, 1.78, 0.02]} />
        {/* Băng tay màu phe (chiến trường), to hơn thật để nhìn xa còn nhận ra. */}
        {band && <mesh geometry={G.band} material={mat(band)} position={[0, 1.42, 0]} />}
        {gun && <mesh geometry={G.gun} material={metal} position={[0.12, 1.35, 0.35]} rotation-x={prone ? -1.45 : 0} />}
      </group>
    </group>
  );
});
