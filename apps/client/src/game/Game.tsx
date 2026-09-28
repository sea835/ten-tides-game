import { Suspense, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { ANCHORS } from "@tentides/content";
import type { DirectionalLight, HemisphereLight } from "three";
import type { IslandRoom } from "../net.ts";
import { Anchors } from "./Anchors.tsx";
import { DayCycle } from "./DayCycle.tsx";
import { Hud } from "./hud/Hud.tsx";
import { Island } from "./Island.tsx";
import { LocalPlayer } from "./LocalPlayer.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";
import { bindInput, look } from "./input.ts";
import { localPosition } from "./shared.ts";

const SKY = "#bfe3f5";

/** Móc debug khi dev: xem room, vị trí, hướng nhìn và camera trong console trình duyệt. */
function DebugHook({ room }: { room: IslandRoom }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __tentides: { room, look, localPosition, camera, anchors: ANCHORS } });
  }, [room, camera]);
  return null;
}

export function Game({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => bindInput(wrapper.current!), []);


  return (
    <div className="game" ref={wrapper}>
      <Canvas shadows="percentage" dpr={[1, 1.5]} camera={{ fov: 60, near: 0.1, far: 400 }}>
        <color attach="background" args={[SKY]} />
        <fog attach="fog" args={[SKY, 70, 230]} />
        <hemisphereLight ref={sky} args={["#e0f4ff", "#c2a36b", 1.1]} />
        <directionalLight
          ref={sun}
          intensity={2.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
          shadow-camera-far={150}
        />
        <Suspense fallback={null}>
          <Physics>
            <Island />
            <LocalPlayer room={room} />
          </Physics>
          <RemotePlayers room={room} />
          <Anchors room={room} />
          <DayCycle room={room} sun={sun} sky={sky} />
          <DebugHook room={room} />
        </Suspense>
      </Canvas>
      <Hud room={room} onLeave={onLeave} />
    </div>
  );
}
