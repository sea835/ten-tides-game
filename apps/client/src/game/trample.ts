import { Vector4 } from "three";

// Cỏ tương tác: tối đa 8 "vật giẫm" (mình, người gần nhất, xe) và 4 vụ nổ gần đây truyền vào shader thảm cỏ (Grass.tsx)
// và bụi cỏ lay gió (swayMaterial trong nature.ts). Lá cỏ trong bán kính dạt ra hai bên, rạp xuống, rồi tự đứng lên khi
// vật đi qua (vết chân của mình để lại vài điểm mờ dần nên cỏ hồi từ từ chứ không bật thẳng ngay). Vụ nổ đẩy một vòng
// xung kích lan ra (~8 m) làm rạp cỏ trong chốc lát. Atmosphere.tsx ghi các mảng này mỗi khung hình.

export const TRAMPLERS = 8;
export const TRAMPLE_BLASTS = 4;

export const trampleUniforms = {
  /** x, z, bán kính (m), độ mạnh (0–1). Bán kính 0 là ô trống. */
  uTramplers: { value: Array.from({ length: TRAMPLERS }, () => new Vector4()) },
  /** x, z, tuổi (giây), bán kính (m). Bán kính 0 là ô trống. */
  uTrampleBlasts: { value: Array.from({ length: TRAMPLE_BLASTS }, () => new Vector4()) },
};

/** Khai báo uniform và hàm `tenTrample(xz)`: xy là hướng dạt (độ dài 0–1), z là mức rạp xuống (0–1). */
export const TRAMPLE_GLSL = /* glsl */ `
uniform vec4 uTramplers[${TRAMPLERS}];
uniform vec4 uTrampleBlasts[${TRAMPLE_BLASTS}];
vec3 tenTrample( vec2 xz ) {
  vec2 push = vec2( 0.0 );
  float press = 0.0;
  for ( int i = 0; i < ${TRAMPLERS}; i++ ) {
    vec4 t = uTramplers[ i ];
    if ( t.z <= 0.0 ) continue;
    vec2 d = xz - t.xy;
    float dist = length( d );
    float w = t.w * ( 1.0 - smoothstep( t.z * 0.3, t.z, dist ) );
    push += d / max( dist, 0.05 ) * w;
    press = max( press, w );
  }
  for ( int i = 0; i < ${TRAMPLE_BLASTS}; i++ ) {
    vec4 b = uTrampleBlasts[ i ];
    if ( b.w <= 0.0 ) continue;
    vec2 d = xz - b.xy;
    float dist = length( d );
    // Mặt sóng lan ra ~26 m/s: chỗ sóng đã quét qua thì rạp hẳn, rồi đứng dậy dần trong ~1,5 giây.
    float hit = ( 1.0 - smoothstep( b.z * 26.0 - 1.5, b.z * 26.0, dist ) ) * ( 1.0 - smoothstep( b.w * 0.55, b.w, dist ) );
    float w = hit * ( 1.0 - smoothstep( 0.3, 1.6, b.z ) );
    push += d / max( dist, 0.05 ) * w * 1.4;
    press = max( press, w );
  }
  float len = length( push );
  if ( len > 1.0 ) push /= len;
  return vec3( push, min( press, 1.0 ) );
}
`;
