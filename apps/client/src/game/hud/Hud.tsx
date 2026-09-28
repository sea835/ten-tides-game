import { useEffect } from "react";
import type { IslandRoom } from "../../net.ts";
import { listenChat } from "../chatStore.ts";
import { BackpackViewer, PackingScreen } from "./Backpack.tsx";
import { Campfire, GhostChat, LobbyChat } from "./Campfire.tsx";
import { CharacterCreator } from "./CharacterCreator.tsx";
import { EventCard } from "./EventCard.tsx";
import { Feed } from "./Feed.tsx";
import { EndScreen, InteractPrompt, PausedOverlay, Toast } from "./Overlays.tsx";
import { PhaseBanner } from "./PhaseBanner.tsx";
import { RoomPanel } from "./RoomPanel.tsx";
import { SelfPanel } from "./SelfPanel.tsx";
import { StatusPanel } from "./StatusPanel.tsx";
import { Journal } from "./Story.tsx";

export function Hud({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  useEffect(() => listenChat(room), [room]);
  return (
    <div className="hud">
      <RoomPanel room={room} onLeave={onLeave} />
      <StatusPanel room={room} />
      <PhaseBanner room={room} />
      <SelfPanel room={room} />
      <Feed room={room} />
      <InteractPrompt room={room} />
      <EventCard room={room} />
      <Campfire room={room} />
      <LobbyChat room={room} />
      <GhostChat room={room} />
      <Toast room={room} />
      <PausedOverlay room={room} />
      <CharacterCreator room={room} />
      <PackingScreen room={room} />
      <BackpackViewer room={room} />
      <Journal room={room} />
      <EndScreen room={room} onLeave={onLeave} />
      <section className="panel help">
        Bấm vào màn hình để xoay camera · WASD di chuyển · Shift chạy · Space nhảy · E mở sự kiện · B xem balo · J sổ truyện · Enter chat · Esc thả chuột
      </section>
    </div>
  );
}
