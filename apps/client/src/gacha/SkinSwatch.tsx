import { SKIN, type SkinDef } from "@tentides/content";
import { swatchStyle } from "./swatch.ts";

/** Ô xem trước skin: hình súng (mặt nạ SVG) tô bằng vân của skin. `bare` là ô chữ nhật, không cắt hình súng. */
export function SkinSwatch({ skin, size = "md", bare = false }: { skin: SkinDef | string | null | undefined; size?: "sm" | "md" | "lg"; bare?: boolean }) {
  const def = typeof skin === "string" ? SKIN.get(skin) : skin;
  if (!def) return <div className={`skin-swatch ${size} empty${bare ? " bare" : ""}`} aria-hidden />;
  return <div className={`skin-swatch ${size} ${def.finish.kind}${bare ? " bare" : ""}`} style={swatchStyle(def.finish)} aria-hidden />;
}
