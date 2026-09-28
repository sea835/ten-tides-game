import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { ANCHORS } from "@tentides/content";
import type { DirectionalLight, HemisphereLight, PointLight } from "three";
import type { IslandRoom } from "../net.ts";
import { Anchors } from "./Anchors.tsx";
import { Controls } from "./Controls.tsx";
import { Fx } from "./Fx.tsx";
import { listenFx } from "./fxStore.ts";
import { GroundItems } from "./Items3D.tsx";
import { DayCycle } from "./DayCycle.tsx";
import { toggleQuality, useQuality } from "./graphics.ts";
import { Hud } from "./hud/Hud.tsx";
import { Island } from "./Island.tsx";
import { LocalPlayer } from "./LocalPlayer.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";
import { SkyDome } from "./Sky.tsx";
import { bindInput, isTyping, look } from "./input.ts";
import { debugCam, localEnv, localPosition } from "./shared.ts";
import { useWorld } from "./world.ts";

const HORIZON = "#c4e4f3";

/** Móc debug khi dev: xem room, vị trí, hướng nhìn và camera trong console trình duyệt. */
function DebugHook({ room }: { room: IslandRoom }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const world = useWorld(room);
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __tentides: { room, look, localPosition, camera, scene, anchors: ANCHORS, world, debugCam } });
  }, [room, camera, scene, world]);
  return null;
}

/**
 * Ánh sáng quanh người: trong hang, hầm thì có quầng sáng nhỏ (to và ấm hơn hẳn nếu mang đèn dầu hay đuốc).
 * Đèn luôn tồn tại (chỉ đổi độ sáng) để số nguồn sáng không đổi, tránh dựng lại shader.
 */
function PlayerLight() {
  const light = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const l = light.current;
    if (!l) return;
    l.position.set(localPosition.x, localPosition.y + 2, localPosition.z);
    const flicker = 1 + Math.sin(clock.elapsedTime * 13) * 0.05 + Math.sin(clock.elapsedTime * 7.3) * 0.04;
    l.intensity = localEnv.indoor * (localEnv.light ? 26 : 5) * flicker;
    l.distance = localEnv.light ? 16 : 7;
  });
  return <pointLight ref={light} color="#ffb070" intensity={0} distance={10} decay={1.4} />;
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
  const world = useWorld(room);

  useEffect(() => bindInput(wrapper.current!), []);
  useEffect(() => listenFx(room), [room]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTyping(e) && e.code === "KeyG" && !e.repeat) toggleQuality();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="game" ref={wrapper}>
      <Canvas shadows="percentage" dpr={high ? [1, 2] : [1, 1]} camera={{ fov: 60, near: 0.1, far: 500 }}>
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
          {/* Đổi bản đồ (chủ phòng đổi seed ở sảnh chờ) thì dựng lại cả vật lý lẫn cảnh. */}
          <Physics key={world.seed}>
            <Island room={room} world={world} />
            <LocalPlayer room={room} world={world} />
          </Physics>
          <PlayerLight />
          <RemotePlayers room={room} />
          <Anchors room={room} />
          <GroundItems room={room} />
          <Fx />
          <DayCycle room={room} sun={sun} hemi={hemi} />
          <DebugHook room={room} />
          {high && <PostFx />}
        </Suspense>
      </Canvas>
      <Controls room={room} />
      <Hud room={room} onLeave={onLeave} />
    </div>
  );
}
