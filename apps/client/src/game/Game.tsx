import { Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { ANCHORS } from "@tentides/content";
import type { DirectionalLight, HemisphereLight, PointLight, Scene } from "three";
import type { WebGPURenderer } from "three/webgpu";
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
import { StaticSun } from "./StaticShadows.tsx";
import { installStaticShadows } from "./staticShadow.ts";
import { Atmosphere } from "./Atmosphere.tsx";
import { cloudUniforms, installAtmosphere, shadeLightWithClouds, wetUniforms } from "./atmosphere.ts";
import { makeRenderer } from "./gpu/renderer.ts";
import { weatherUniforms } from "./textures.ts";
import { trampleUniforms } from "./trample.ts";
import { createPostFx, type PostFx } from "./postFx.ts";
import { setPrepTargets } from "./shaderPrep.ts";
import { RainGlass } from "./RainGlass.tsx";
import { profileOf, cycleQuality, getGraphics, renderHints, targetDpr, toggleStats, useProfile, useQuality, type Profile } from "./graphics.ts";
import { platform } from "./platform.ts";
import { FrameDriver, PerfOverlay } from "./FrameDriver.tsx";
import { Hud } from "./hud/Hud.tsx";
import { Island } from "./Island.tsx";
import { LocalPlayer } from "./LocalPlayer.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";
import { SkyDome, SkyEnvironment } from "./Sky.tsx";
import { bindInput, isTyping, look } from "./input.ts";
import { debugCam, localEnv, localPosition, weatherFx } from "./shared.ts";
import { useMapKey, useWorld } from "./world.ts";
import { useRoomSnapshot } from "./useRoomSnapshot.ts";
import { cameraMode } from "./camera.ts";
import { BattleIsland } from "./battle/BattleWorld.tsx";
import { BattleEffects } from "./battle/Effects.tsx";
import { BattleHud, SettingsButton } from "./battle/BattleHud.tsx";
import { Shooter } from "./battle/Shooter.tsx";
import { ViewModel, ViewPass, createViewLayer, viewCamera } from "./battle/ViewModel.tsx";
import { Killcam } from "./battle/Killcam.tsx";
import { SpectatorCamera } from "./battle/Spectator.tsx";
import { Vehicles } from "./battle/Vehicles.tsx";
import { VoiceHeads } from "./voice/VoiceHeads.tsx";
import { viewReach } from "./DayCycle.tsx";
import { Ships } from "./naval/Ships.tsx";
import { NavalUnits } from "./naval/NavalUnits.tsx";
import { NavalFx } from "./naval/NavalFx.tsx";
import { NavalSounds } from "./naval/NavalSounds.tsx";
import { NavalControl } from "./naval/NavalControl.tsx";

const HORIZON = "#c4e4f3";

installStaticShadows();

/** Móc debug khi dev: xem room, vị trí, hướng nhìn và camera trong console trình duyệt. */
function DebugHook({ room }: { room: IslandRoom }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  // Kho trạng thái R3F (renderer, danh sách vòng cập nhật useFrame) để đo hiệu năng trong console.
  const r3f = useThree((s) => s.get);
  const world = useWorld(room);
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as { __tentides?: Record<string, unknown> };
      w.__tentides = { ...(w.__tentides ?? {}), room, look, localPosition, camera, scene, r3f, anchors: ANCHORS, world, debugCam, weatherFx, audio, atmosphere: { cloudUniforms, wetUniforms, weatherUniforms, trampleUniforms } };
    }
  }, [room, camera, scene, r3f, world]);
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
 * Vẽ cả khung hình. R3F chỉ tự vẽ khi không ai đăng ký useFrame ưu tiên dương; ta đăng ký (ưu tiên 1) nên tự vẽ ở đây,
 * trước lượt vẽ súng trước mặt của mức đồ hoạ thấp (ViewPass, ưu tiên 2).
 * - Có hậu kỳ (Trung bình, Cao): chuỗi node của postFx.ts (AO chỉ ở Cao, tia nắng, bloom, tone map AgX, chấm màu, góc
 *   tối, súng trước mặt, khử răng cưa); bật tắt AO thì dựng lại cả chuỗi.
 * - Không hậu kỳ (Thấp): vẽ thẳng cảnh ra màn hình (canvas bật MSAA, tone map do renderer làm).
 */
function RenderDriver({ post, battle }: { post: Profile["post"]; battle: boolean }) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  // Tạo và huỷ trong cùng một effect (StrictMode chạy effect hai lần). Khung nào chưa có chuỗi thì vẽ thẳng.
  const [fx, setFx] = useState<PostFx | null>(null);
  useEffect(() => {
    const f = post === "none" ? null : createPostFx(gl, scene, camera, post === "full", battle ? createViewLayer(scene, camera) : null);
    // Dịch sẵn shader đúng đích vẽ thật (ảnh của pass khi có hậu kỳ, màn hình khi không), cả lớp súng trước mặt.
    setPrepTargets(f ? f.targets : battle ? [{ target: null }, { target: null, camera: viewCamera }] : [{ target: null }]);
    setFx(f);
    return () => {
      setFx(null);
      f?.dispose();
    };
  }, [gl, scene, camera, post, battle]);
  useFrame(() => {
    if (fx) fx.render();
    else gl.render(scene, camera);
  }, 1);
  return null;
}

/**
 * Bóng đổ vẽ lại theo nhịp của mức chất lượng thay vì mọi khung hình (mặt trời gần như đứng yên; tâm vùng bóng
 * khớp lưới điểm ảnh nên bản đồ bóng cũ vẫn đúng chỗ, chỉ vật đang chuyển động là bóng trễ vài chục ms). `hz` = 0 thì
 * đèn tự vẽ lại mọi khung. Đèn mặt trời tạo lại khi đổi mức đồ hoạ nên áp lại cho đèn mới.
 */
function ShadowScheduler({ sun, hz }: { sun: RefObject<DirectionalLight | null>; hz: number }) {
  const due = useRef(0);
  const bound = useRef<DirectionalLight | null>(null);
  useFrame(({ clock }) => {
    const light = sun.current;
    if (!light) return;
    if (bound.current !== light) {
      bound.current = light;
      light.shadow.autoUpdate = hz === 0;
      light.shadow.needsUpdate = true;
    }
    light.shadow.autoUpdate = hz === 0;
    if (hz === 0 || clock.elapsedTime < due.current) return;
    // Trễ nhịp (tab bị ẩn) thì bắt lại từ bây giờ, không dồn nhiều lần vẽ liền nhau.
    due.current = Math.max(due.current + 1 / hz, clock.elapsedTime);
    light.shadow.needsUpdate = true;
  });
  return null;
}

function Sun({ sun, profile, quality }: { sun: RefObject<DirectionalLight | null>; profile: Profile; quality: string }) {
  const e = profile.shadowExtent;
  // Bóng mây che nắng: gắn một lần vào đèn (đổi mức đồ hoạ thì đèn tạo lại).
  useEffect(() => {
    if (sun.current) shadeLightWithClouds(sun.current);
  }, [sun, quality]);
  // Cùng một nhóm với StaticSun: nó gắn bản đồ bóng tĩnh vào bóng của mặt trời (xem staticShadow.ts).
  return (
    <group key={quality}>
      <directionalLight
        ref={sun}
        intensity={2.2}
        castShadow
        shadow-mapSize={[profile.shadowMap, profile.shadowMap]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.04}
        shadow-radius={profile.shadowRadius}
        shadow-camera-left={-e}
        shadow-camera-right={e}
        shadow-camera-top={e}
        shadow-camera-bottom={-e}
        shadow-camera-far={180}
      />
      <StaticSun sun={sun} profile={profile} />
    </group>
  );
}

export function Game({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  // Trình duyệt không có cả WebGPU lẫn WebGL 2 (bản quá cũ, card bị chặn): báo rõ thay vì màn hình trắng.
  if (!platform().webgl2 && !platform().webgpu) {
    return (
      <div className="game-loading">
        Trình duyệt này không chạy được đồ hoạ 3D (cần WebGPU hoặc WebGL 2). Hãy cập nhật Chrome, Edge, Firefox hoặc Safari và bật tăng tốc phần cứng.
        <button onClick={onLeave}>Về sảnh</button>
      </div>
    );
  }
  return <GameView room={room} onLeave={onLeave} />;
}

/**
 * Bản phát hành bỏ bước đọc nhật ký lỗi của từng shader sau khi dịch (three mặc định bật): mỗi lần đọc là một lệnh
 * đồng bộ phải chờ trình điều khiển, trên Windows/ANGLE đắt hơn hẳn. Bản dev vẫn bật để thấy lỗi shader.
 */
function onCreated({ scene, gl }: { scene: Scene; gl: unknown }) {
  (gl as WebGPURenderer).debug.checkShaderErrors = import.meta.env.DEV;
  // Sương mù bám độ cao cho mọi vật liệu (node sương của cảnh).
  installAtmosphere(scene);
}

function GameView({ room, onLeave }: { room: IslandRoom; onLeave: () => void }) {
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const quality = useQuality();
  const profile = useProfile();
  const post = profile.post !== "none";
  // Độ phân giải lúc tạo canvas; sau đó FrameDriver tự chỉnh.
  const [initialDpr] = useState(() => targetDpr(getGraphics()));
  // Thông số ngữ cảnh WebGL (chỉ đặt được lúc tạo canvas):
  // - Có hậu kỳ thì cảnh vẽ vào ảnh trung gian và đã có SMAA khử răng cưa: bộ đệm MSAA của canvas chỉ tốn thêm băng
  //   thông (nặng nhất trên Windows, nơi ANGLE phải gộp mẫu MSAA mỗi khung). Chỉ bật MSAA khi không có hậu kỳ.
  // - Canvas đục: trình duyệt khỏi phải trộn trong suốt với trang web mỗi khung.
  // - Xin card rời trên laptop hai card (Windows, Mac đời Intel).
  const [glFactory] = useState(() => makeRenderer({ antialias: profileOf(getGraphics().quality).post === "none", alpha: false, stencil: false, powerPreference: "high-performance" }));
  const mapKey = useMapKey(room);
  const world = useWorld(room);
  // Phòng Battleground: bản đồ, luật, điều khiển và giao diện riêng; đồ hoạ, nhân vật, vật lý dùng chung.
  const battle = useRoomSnapshot(room, (s) => s.mode) === "battle";
  cameraMode.battle = battle;
  // Hải chiến 3 vs 3: hai chiến hạm, biển rộng, nhìn xa hơn nhiều (đánh nhau ở tầm gần một cây số).
  const naval = useRoomSnapshot(room, (s) => s.mode === "battle" && s.battleMode === "naval");
  viewReach.scale = naval ? 5.5 : 1;
  renderHints.idle = useRoomSnapshot(room, (s) => s.paused);
  useEffect(() => () => void (renderHints.idle = false), []);

  useEffect(() => bindInput(wrapper.current!), []);
  useEffect(() => listenFx(room), [room]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      if (e.code === "KeyP") cycleQuality();
      if (e.code === "F3") {
        e.preventDefault();
        toggleStats();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="game" ref={wrapper}>
      <Canvas shadows="percentage" frameloop="never" dpr={initialDpr} gl={glFactory} camera={{ fov: 60, near: 0.1, far: 500 }} onCreated={onCreated}>
        <FrameDriver />
        <ShadowScheduler sun={sun} hz={profile.shadowHz} />
        <color attach="background" args={[HORIZON]} />
        <fog attach="fog" args={[HORIZON, 70, 230]} />
        <hemisphereLight ref={hemi} args={["#e0f4ff", "#c2a36b", 1.1]} />
        {profile.ibl && <SkyEnvironment intensity={0.7} />}
        <Sun sun={sun} profile={profile} quality={quality} />
        <Suspense fallback={null}>
          <SkyDome />
          {/* Đổi bản đồ (chủ phòng đổi seed ở sảnh chờ) thì dựng lại cả vật lý lẫn cảnh. */}
          {/* Bước vật lý theo đúng từng khung hình: nhân vật và camera cùng nhịp, chạy nhanh không bị giật. */}
          <Physics key={`${world.seed}:${mapKey}`} timeStep="vary">
            {battle ? <BattleIsland room={room} world={world} /> : <Island room={room} world={world} />}
            <LocalPlayer room={room} world={world} />
            {battle && <Shooter room={room} />}
            {battle && <Vehicles room={room} />}
            {naval && <Ships room={room} />}
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
          {naval && <NavalUnits room={room} />}
          {naval && <NavalFx room={room} />}
          {naval && <NavalSounds room={room} />}
          {naval && <NavalControl room={room} />}
          {battle && <ViewModel room={room} />}
          {battle && <Killcam room={room} />}
          {battle && <SpectatorCamera room={room} />}
          {battle && <VoiceHeads room={room} />}
          <Soundscape room={room} world={world} />
          <Fx />
          <WaypointTracker />
          <Texturize />
          <DayCycle room={room} sun={sun} hemi={hemi} ibl={profile.ibl} />
          <Atmosphere room={room} />
          <DebugHook room={room} />
          <RenderDriver post={profile.post} battle={battle} />
          {battle && <ViewPass post={post} />}
        </Suspense>
      </Canvas>
      <RainGlass />
      <PerfOverlay />
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
