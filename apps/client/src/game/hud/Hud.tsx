import { useEffect } from "react";
import type { IslandRoom } from "../../net.ts";
import { listenChat } from "../chatStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { BackpackViewer, PackingScreen } from "./Backpack.tsx";
import { Campfire, GhostChat, LobbyChat } from "./Campfire.tsx";
import { CharacterCreator } from "./CharacterCreator.tsx";
import { PhaseClock, PhaseSplash } from "./Clock.tsx";
import { EventCard } from "./EventCard.tsx";
import { Feed } from "./Feed.tsx";
import { Hotbar, StatusOverlay } from "./Hands.tsx";
import { TouchControls } from "./TouchControls.tsx";
import { EncounterToast, EndScreen, EnvironmentOverlay, InteractPrompt, KeyHints, PausedOverlay, PostureBadge, Toast } from "./Overlays.tsx";
import { PhaseBanner } from "./PhaseBanner.tsx";
import { RoomPanel } from "./RoomPanel.tsx";
import { SelfPanel } from "./SelfPanel.tsx";
import { StatusPanel } from "./StatusPanel.tsx";
import { Journal } from "./Story.tsx";

/** Pha có màn riêng che cả màn hình: ẩn các khung HUD đằng sau cho đỡ rối. */
const FULLSCREEN_PHASES = new Set(["create", "pack", "ended"]);

export function Hud({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  useEffect(() => listenChat(room), [room]);
  const phase = useRoomSnapshot(room, (s) => s.phase);
  const fullscreen = FULLSCREEN_PHASES.has(phase);
  return (
    <div className={`hud phase-${phase}`}>
      {!fullscreen && <EnvironmentOverlay room={room} />}
      {!fullscreen && <StatusOverlay room={room} />}
      {!fullscreen && (
        <>
          <RoomPanel room={room} onLeave={onLeave} />
          <PhaseClock room={room} />
          <StatusPanel room={room} />
          <PhaseBanner room={room} />
          <SelfPanel room={room} />
          <Feed room={room} />
          <KeyHints />
          <InteractPrompt room={room} />
          <Hotbar room={room} />
          <TouchControls room={room} />
          <PostureBadge />
          <EventCard room={room} />
          <Campfire room={room} />
          <LobbyChat room={room} />
          <GhostChat room={room} />
          <BackpackViewer room={room} />
          <Journal room={room} />
        </>
      )}
      <PhaseSplash room={room} />
      <Toast room={room} />
      <EncounterToast room={room} />
      <PausedOverlay room={room} />
      <CharacterCreator room={room} />
      <PackingScreen room={room} />
      <EndScreen room={room} onLeave={onLeave} />
    </div>
  );
}
