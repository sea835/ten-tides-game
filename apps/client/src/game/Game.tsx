import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { N8AOPostPass } from "n8ao";
import { ToneMappingMode } from "postprocessing";
import { ANCHORS } from "@tentides/content";
import type { DirectionalLight, HemisphereLight, PointLight } from "three";
import type { IslandRoom } from "../net.ts";
import { Anchors } from "./Anchors.tsx";
import { Controls } from "./Controls.tsx";
import { FirstPersonHands } from "./FirstPerson.tsx";
import { Fx } from "./Fx.tsx";
import { listenFx } from "./fxStore.ts";
import { GroundItems } from "./Items3D.tsx";
import { Pages } from "./Pages.tsx";
import { audio } from "./sound/engine.ts";
import { Soundscape } from "./sound/Soundscape.tsx";
import { Texturize } from "./Texturize.tsx";
import { Trails } from "./Trails.tsx";
import { WaypointTracker } from "./Waypoint.tsx";
import { Weather } from "./Weather.tsx";
import { DayCycle } from "./DayCycle.tsx";
import { toggleQuality, useQuality } from "./graphics.ts";
import { Hud } from "./hud/Hud.tsx";
import { Island } from "./Island.tsx";
import { LocalPlayer } from "./LocalPlayer.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";
import { SkyDome, SkyEnvironment } from "./Sky.tsx";
import { bindInput, isTyping, look } from "./input.ts";
import { debugCam, localEnv, localPosition, weatherFx } from "./shared.ts";
import { useWorld } from "./world.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { cameraMode } from "./camera.ts";
import { BattleIsland } from "./battle/BattleWorld.tsx";
import { BattleEffects } from "./battle/Effects.tsx";
import { BattleHud, SettingsButton } from "./battle/BattleHud.tsx";
import { Shooter } from "./battle/Shooter.tsx";
import { ViewModel, ViewPass } from "./battle/ViewModel.tsx";

const HORIZON = "#c4e4f3";

/** Móc debug khi dev: xem room, vị trí, hướng nhìn và camera trong console trình duyệt. */
function DebugHook({ room }: { room: IslandRoom }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const world = useWorld(room);
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as { __tentides?: Record<string, unknown> };
      w.__tentides = { ...(w.__tentides ?? {}), room, look, localPosition, camera, scene, anchors: ANCHORS, world, debugCam, weatherFx, audio };
    }
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

/**
 * Hậu kỳ (chỉ ở chất lượng cao): bóng tối ở khe, góc, chân cây (ambient occlusion); lửa, dung nham, nắng loá
 * toả quầng; tone map kiểu phim (AgX, màu tự nhiên, không cháy sáng); chỉnh màu nhẹ; góc màn hình tối nhẹ.
 */
function PostFx() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  // Tạo và huỷ trong cùng một effect (StrictMode chạy effect hai lần).
  const [ao, setAo] = useState<N8AOPostPass | null>(null);
  useEffect(() => {
    const pass = new N8AOPostPass(scene, camera, size.width, size.height);
    pass.configuration.aoRadius = 1.6;
    pass.configuration.distanceFalloff = 1;
    pass.configuration.intensity = 2.2;
    pass.configuration.halfRes = true;
    pass.configuration.gammaCorrection = false;
    pass.setQualityMode("Medium");
    setAo(pass);
    return () => pass.dispose();
    // Kích thước đổi thì EffectComposer tự gọi setSize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera]);
  if (!ao) return null;
  return (
    <EffectComposer multisampling={0}>
      <primitive object={ao} />
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.7} radius={0.75} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <HueSaturation saturation={0.22} />
      <BrightnessContrast contrast={0.14} />
      <Vignette offset={0.3} darkness={0.5} />
      <SMAA />
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
  // Phòng Battleground: bản đồ, luật, điều khiển và giao diện riêng; đồ hoạ, nhân vật, vật lý dùng chung.
  const battle = useRoomSnapshot(room, (s) => s.mode) === "battle";
  cameraMode.battle = battle;

  useEffect(() => bindInput(wrapper.current!), []);
  useEffect(() => listenFx(room), [room]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTyping(e) && e.code === "KeyP" && !e.repeat) toggleQuality();
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
        {high && <SkyEnvironment intensity={0.7} />}
        <directionalLight
          ref={sun}
          intensity={2.2}
          castShadow
          key={quality}
          shadow-mapSize={high ? [4096, 4096] : [1024, 1024]}
          shadow-bias={-0.0003}
          shadow-normalBias={0.04}
          shadow-radius={high ? 4 : 1}
          shadow-blurSamples={12}
          shadow-camera-left={high ? -55 : -35}
          shadow-camera-right={high ? 55 : 35}
          shadow-camera-top={high ? 55 : 35}
          shadow-camera-bottom={high ? -55 : -35}
          shadow-camera-far={180}
        />
        <Suspense fallback={null}>
          <SkyDome />
          {/* Đổi bản đồ (chủ phòng đổi seed ở sảnh chờ) thì dựng lại cả vật lý lẫn cảnh. */}
          {/* Bước vật lý theo đúng từng khung hình: nhân vật và camera cùng nhịp, chạy nhanh không bị giật. */}
          <Physics key={world.seed} timeStep="vary">
            {battle ? <BattleIsland room={room} world={world} /> : <Island room={room} world={world} />}
            <LocalPlayer room={room} world={world} />
            {battle && <Shooter room={room} />}
          </Physics>
          <PlayerLight />
          {!battle && <FirstPersonHands room={room} />}
          <RemotePlayers room={room} />
          {!battle && <Anchors room={room} />}
          <GroundItems room={room} />
          {!battle && <Pages room={room} world={world} />}
          <Weather room={room} world={world} />
          {!battle && <Trails room={room} world={world} />}
          {battle && <BattleEffects room={room} world={world} />}
          {battle && <ViewModel room={room} />}
          <Soundscape room={room} world={world} />
          <Fx />
          <WaypointTracker />
          <Texturize />
          <DayCycle room={room} sun={sun} hemi={hemi} ibl={high} />
          <DebugHook room={room} />
          {high && <PostFx />}
          {battle && <ViewPass post={high} />}
        </Suspense>
      </Canvas>
      {battle ? (
        <BattleHud room={room} onLeave={onLeave} />
      ) : (
        <>
          <Controls room={room} />
          <Hud room={room} onLeave={onLeave} />
          <div className="hud story-settings">
            <SettingsButton />
          </div>
        </>
      )}
    </div>
  );
}
