"use client";

/**
 * MORI 구체 — 바닐라 three.js 디스토션 셰이더 구. 막대형 EQ 금지(스펙 §3).
 *
 * (@react-three/fiber는 전역 JSX 네임스페이스를 오염시켜 프로젝트 전체 컴포넌트
 *  props를 never로 붕괴시키므로 사용하지 않음. three만 직접 쓴다.)
 *
 * 5상태: 대기(호흡)·듣는 중(마이크 진폭 반응)·생각 중(입자 회전+빠른 일렁임)·말하는 중·능동발화(골드).
 * 상태/진폭/dimmed는 ref로 매 프레임 읽어 씬 재생성 없이 반영. 진폭=ampRef(0~1).
 */

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const VERT = /* glsl */ `
uniform float uTime;
uniform float uDistort;
uniform float uAmp;
varying vec3 vNormal;
varying float vNoise;

// Ashima simplex noise 3D
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+1.0*C.xxx; vec3 x2=x0-i2+2.0*C.xxx; vec3 x3=x0-1.0+3.0*C.xxx;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

void main(){
  vNormal = normalize(normalMatrix * normal);
  float n = snoise(normal * 1.6 + uTime * 0.4);
  float disp = n * uDistort * (1.0 + uAmp * 1.4);
  vNoise = n;
  vec3 p = position + normal * disp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uGoldColor;
uniform float uEmissive;
varying vec3 vNormal;
varying float vNoise;

void main(){
  // 프레넬 림(가장자리 발광)
  float fres = pow(1.0 - abs(vNormal.z), 2.2);
  vec3 base = mix(uColorB, uColorA, clamp(vNoise * 0.5 + 0.65, 0.0, 1.0));
  base += fres * 0.5;                       // 림 하이라이트
  base = mix(base, uGoldColor, uEmissive);  // 골드 발광 혼합
  gl_FragColor = vec4(base, 1.0);
}
`;

export default function MoriOrb({
  state,
  ampRef,
  gold,
  dimmed,
}: {
  state: OrbState;
  ampRef: RefObject<number>;
  gold: boolean;
  dimmed: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  // 최신 props를 애니메이션 루프가 읽도록 ref로 보관
  const stateRef = useRef(state);
  const goldRef = useRef(gold);
  const dimRef = useRef(dimmed);
  stateRef.current = state;
  goldRef.current = gold;
  dimRef.current = dimmed;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 3.2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const uniforms = {
      uTime: { value: 0 },
      uDistort: { value: 0.16 },
      uAmp: { value: 0 },
      uColorA: { value: new THREE.Color("#E8ECF0") },
      uColorB: { value: new THREE.Color("#1A2332") },
      uGoldColor: { value: new THREE.Color("#F4E4C1") },
      uEmissive: { value: 0 },
    };
    const geo = new THREE.IcosahedronGeometry(1.1, 24);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);

    // 생각 중 내부 입자
    const PCOUNT = 60;
    const pPos = new Float32Array(PCOUNT * 3);
    for (let i = 0; i < PCOUNT; i++) {
      const r = 0.55 + Math.random() * 0.35;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pPos[i * 3 + 2] = r * Math.cos(ph);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: new THREE.Color("#8b9bdc"), size: 0.045, transparent: true, opacity: 0 });
    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);

    const colA = new THREE.Color();
    const lerpColor = (target: string, amt: number) => {
      colA.set(target);
      uniforms.uColorA.value.lerp(colA, amt);
    };

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const dt = clock.getDelta();
      const t = clock.elapsedTime;
      const st = stateRef.current;
      const amp = ampRef.current ?? 0;

      let distort = 0.16, speed = 0.4, scale = 1, pOpacity = 0;
      if (st === "idle") {
        scale = 1 + Math.sin(t * ((Math.PI * 2) / 4)) * 0.025; // 4초 호흡
        distort = 0.16; speed = 0.35;
        lerpColor("#E8ECF0", 0.05);
      } else if (st === "listening") {
        distort = 0.22 + amp * 0.6; speed = 0.9; scale = 1 + amp * 0.14;
        lerpColor("#aab8e0", 0.08);
      } else if (st === "thinking") {
        distort = 0.3; speed = 1.0; scale = 1 + Math.sin(t * 3) * 0.012; pOpacity = 0.85;
        lerpColor("#cdd7e6", 0.05);
      } else {
        distort = 0.26 + amp * 0.45; speed = 0.8; scale = 1 + amp * 0.1 + Math.sin(t * 6) * 0.01;
        lerpColor("#E8ECF0", 0.05);
      }

      uniforms.uTime.value += dt * speed * 3.0;
      uniforms.uDistort.value += (distort - uniforms.uDistort.value) * 0.12;
      uniforms.uAmp.value += (amp - uniforms.uAmp.value) * 0.2;
      const targetEmissive = goldRef.current ? 0.85 : st === "speaking" ? 0.12 : 0;
      uniforms.uEmissive.value += (targetEmissive - uniforms.uEmissive.value) * 0.1;

      sphere.scale.setScalar(sphere.scale.x + (scale - sphere.scale.x) * 0.15);
      sphere.rotation.y += dt * 0.12;
      points.rotation.y -= dt * 0.5;
      points.rotation.x += dt * 0.2;
      pMat.opacity += (pOpacity - pMat.opacity) * 0.1;

      renderer.domElement.style.opacity = dimRef.current ? "0.68" : "1";
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      pGeo.dispose();
      pMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [ampRef]);

  return <div ref={mountRef} className="pointer-events-none" style={{ width: "min(48vh, 48vw)", height: "min(48vh, 48vw)" }} />;
}
