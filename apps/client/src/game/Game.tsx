import { Suspense, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import type { DirectionalLight } from "three";
import type { IslandRoom } from "../net.ts";
import { Hud } from "./Hud.tsx";
import { Island } from "./Island.tsx";
import { LocalPlayer } from "./LocalPlayer.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";
import { bindInput } from "./input.ts";

const SKY = "#bfe3f5";

export function Game({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const sun = useRef<DirectionalLight>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => bindInput(wrapper.current!), []);

  return (
    <div className="game" ref={wrapper}>
      <Canvas shadows="percentage" dpr={[1, 1.5]} camera={{ fov: 60, near: 0.1, far: 400 }}>
        <color attach="background" args={[SKY]} />
        <fog attach="fog" args={[SKY, 70, 230]} />
        <hemisphereLight args={["#e0f4ff", "#c2a36b", 1.1]} />
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
            <LocalPlayer room={room} sun={sun} />
          </Physics>
          <RemotePlayers room={room} />
        </Suspense>
      </Canvas>
      <Hud room={room} onLeave={onLeave} />
    </div>
  );
}
