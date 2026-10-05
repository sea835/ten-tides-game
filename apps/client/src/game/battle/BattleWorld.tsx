import { mapOf, type World } from "@tentides/content";
import { WarFlags } from "./WarFlags.tsx";
import { AirdropCrates } from "./Airdrops.tsx";
import type { IslandRoom } from "../../net.ts";
import { Terrain } from "../Island.tsx";
import { WindClock } from "../nature.ts";
import { Trees } from "../Trees.tsx";
import { Vegetation } from "../Vegetation.tsx";
import { Water } from "../Water.tsx";
import { BattleStructures } from "./Structures.tsx";
import { ShaderWarmup } from "./ShaderWarmup.tsx";
import { CommsWorld } from "./CommsWorld.tsx";

/** Cảnh của bản đồ Battleground: địa hình, biển, cây cỏ và mọi công trình (va chạm kèm theo). */
export function BattleIsland({ room, world }: { room: IslandRoom; world: World }) {
  return (
    <>
      <WindClock />
      <Terrain room={room} world={world} />
      <Water world={world} />
      <Trees room={room} world={world} />
      <Vegetation world={world} />
      <BattleStructures room={room} world={world} />
      {mapOf(world).layout === "war" && <WarFlags room={room} />}
      <AirdropCrates room={room} />
      <ShaderWarmup room={room} />
      <CommsWorld room={room} world={world} />
    </>
  );
}
