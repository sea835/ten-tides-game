import { Suspense, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { ANCHORS } from "@tentides/content";
import type { DirectionalLight, HemisphereLight } from "three";
import type { IslandRoom } from "../net.ts";
import { Anchors } from "./Anchors.tsx";
import { DayCycle } from "./DayCycle.tsx";
import { toggleQuality, useQuality } from "./graphics.ts";
import { Hud } from "./hud/Hud.tsx";
import { Island } from "./Island.tsx";
import { LocalPlayer } from "./LocalPlayer.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";
import { SkyDome } from "./Sky.tsx";
import { bindInput, isTyping, look } from "./input.ts";
import { localPosition } from "./shared.ts";

const HORIZON = "#c4e4f3";

/** Móc debug khi dev: xem room, vị trí, hướng nhìn và camera trong console trình duyệt. */
function DebugHook({ room }: { room: IslandRoom }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __tentides: { room, look, localPosition, camera, anchors: ANCHORS } });
  }, [room, camera]);
  return null;
}

/** Hậu kỳ (chỉ ở chất lượng cao): lửa, dung nham, cột sáng toả quầng; góc màn hình tối nhẹ. */
function PostFx() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.8} radius={0.7} />
      <Vignette offset={0.32} darkness={0.55} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

export function Game({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const quality = useQuality();
  const high = quality === "high";

  useEffect(() => bindInput(wrapper.current!), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTyping(e) && e.code === "KeyG" && !e.repeat) toggleQuality();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="game" ref={wrapper}>
      <Canvas shadows="percentage" dpr={high ? [1, 2] : [1, 1]} camera={{ fov: 60, near: 0.1, far: 400 }}>
        <color attach="background" args={[HORIZON]} />
        <fog attach="fog" args={[HORIZON, 70, 230]} />
        <hemisphereLight ref={hemi} args={["#e0f4ff", "#c2a36b", 1.1]} />
        <directionalLight
          ref={sun}
          intensity={2.2}
          castShadow
          key={quality}
          shadow-mapSize={high ? [2048, 2048] : [1024, 1024]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
          shadow-camera-left={-35}
          shadow-camera-right={35}
          shadow-camera-top={35}
          shadow-camera-bottom={-35}
          shadow-camera-far={180}
        />
        <Suspense fallback={null}>
          <SkyDome />
          <Physics>
            <Island room={room} />
            <LocalPlayer room={room} />
          </Physics>
          <RemotePlayers room={room} />
          <Anchors room={room} />
          <DayCycle room={room} sun={sun} hemi={hemi} />
          <DebugHook room={room} />
          {high && <PostFx />}
        </Suspense>
      </Canvas>
      <Hud room={room} onLeave={onLeave} />
    </div>
  );
}
