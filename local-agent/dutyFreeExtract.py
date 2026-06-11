#!/usr/bin/env python3
"""발주제안서 → 품목 JSON (출고 이력/재고차감용). duty_free_docs/src 재사용.
사용: python3 dutyFreeExtract.py <duty_free_docs_dir> <신세계.xlsx|""> <롯데.xlsx|"">"""
import sys, json
from pathlib import Path

DF = Path(sys.argv[1])
sys.path.insert(0, str(DF))
from src import extract_sinsegae, extract_lotte  # noqa: E402

ss = sys.argv[2] if len(sys.argv) > 2 else ""
lt = sys.argv[3] if len(sys.argv) > 3 else ""
out = {}
if ss:
    out["sinsegae"] = [
        {"sku": i.sku, "ref": i.ref, "name": i.name, "qty": i.qty}
        for i in extract_sinsegae(Path(ss))
    ]
if lt:
    out["lotte"] = [
        {"ref": i.ref, "name": i.name, "qty": i.qty, "srp_usd": i.srp_usd, "cost_krw": i.cost_krw}
        for i in extract_lotte(Path(lt))
    ]
print(json.dumps(out, ensure_ascii=False))
