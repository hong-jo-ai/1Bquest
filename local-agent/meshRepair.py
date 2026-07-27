#!/usr/bin/env python3
"""
AI 3D 메시(Meshy/Tripo) 프린트용 수리기 — non-manifold 모서리/정점, 중복·널 페이스,
떠있는 작은 조각, 구멍을 정리해 watertight STL 로 만든다. (엔진: pymeshlab / MeshLab)

사용법:
  python3 meshRepair.py <input.stl> [--drop-islands N] [--out OUT.stl]
  --drop-islands N : 페이스 수 N 미만의 분리된 조각(floating islands) 제거 (기본 0=끔)
  --out            : 출력 경로 (기본 <입력>_repaired.stl)

프린트 바닥 평면(바닥 컷)·스케일·서포트는 슬라이서(Bambu Studio/OrcaSlicer)에서.
"""
import sys, os
import pymeshlab as ml


def topo(ms):
    try:
        d = ms.get_topological_measures()
    except Exception:
        return {}
    keys = ["non_two_manifold_edges", "non_two_manifold_vertices", "boundary_edges",
            "number_holes", "connected_components_number", "is_mesh_watertight"]
    return {k: d.get(k) for k in keys if k in d}


def show(tag, ms):
    m = ms.current_mesh()
    print(f"[{tag}] V={m.vertex_number()} F={m.face_number()}  {topo(ms)}")


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    inp = sys.argv[1]
    drop = 0
    out = os.path.splitext(inp)[0] + "_repaired.stl"
    args = sys.argv[2:]
    for i, a in enumerate(args):
        if a == "--drop-islands" and i + 1 < len(args):
            drop = int(args[i + 1])
        elif a == "--out" and i + 1 < len(args):
            out = args[i + 1]

    ms = ml.MeshSet()
    ms.load_new_mesh(inp)
    show("BEFORE", ms)

    # 1) 기본 클린업
    for f in ("meshing_remove_duplicate_vertices", "meshing_remove_duplicate_faces",
              "meshing_remove_null_faces", "meshing_remove_unreferenced_vertices"):
        try: getattr(ms, f)()
        except Exception as e: print(f"  skip {f}: {e}")

    # 2) 겹친 정점 병합 (non-manifold 상당수 여기서 해소)
    try: ms.meshing_merge_close_vertices()
    except Exception as e: print(f"  skip merge_close: {e}")

    # 3) 떠있는 작은 조각 제거 (선택)
    if drop > 0:
        try:
            ms.meshing_remove_connected_component_by_face_number(mincomponentsize=drop)
            print(f"  dropped islands < {drop} faces")
        except Exception as e: print(f"  skip drop-islands: {e}")

    # 4) non-manifold 모서리/정점 수리
    try: ms.meshing_repair_non_manifold_edges()
    except Exception as e: print(f"  skip repair_nm_edges: {e}")
    try: ms.meshing_repair_non_manifold_vertices()
    except Exception as e: print(f"  skip repair_nm_verts: {e}")

    # 5) 수리로 생긴 구멍 닫기
    try: ms.meshing_close_holes(maxholesize=100, selfintersection=False)
    except Exception as e: print(f"  skip close_holes: {e}")

    # 6) non-manifold 한 번 더 (구멍 닫기 후 재발 방지)
    try: ms.meshing_repair_non_manifold_edges()
    except Exception: pass

    # 7) 법선 재계산
    try:
        ms.compute_normal_per_face(); ms.compute_normal_per_vertex()
    except Exception: pass

    show("AFTER ", ms)
    ms.save_current_mesh(out, binary=True)
    print("SAVED:", out)


if __name__ == "__main__":
    main()
