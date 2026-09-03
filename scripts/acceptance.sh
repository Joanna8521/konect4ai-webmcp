#!/bin/bash
B="${BASE_URL:-https://konect4ai-webmcp.vercel.app}"
JOB=fe6cf2a9-972d-46ee-8e30-7c1904c6ba01
PASS=0; FAIL=0
chk(){ if [ "$2" = "ok" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1 — $3"; FAIL=$((FAIL+1)); fi; }

echo "════ A. 基礎可達性 ════"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$B/"); [ "$C" = 200 ] && chk "首頁 200 / HTTPS" ok || chk "首頁" bad "HTTP $C"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$B/.well-known/agent-card.json"); [ "$C" = 200 ] && chk "Agent Card 可達" ok || chk "Agent Card" bad "HTTP $C"

echo; echo "════ B. 能力清單 ════"
curl -s --max-time 40 "$B/api/konect4ai/tools" > /tmp/_t.json
python3 - <<'PY'
import json,re
d=json.load(open("/tmp/_t.json"))
ts=d.get("tools",[])
n=len(ts); ok=sum(1 for t in ts if re.fullmatch(r'[0-9a-f]{8}-[0-9a-f-]{27}',str(t.get("jobId"))))
leak=sum(1 for t in ts if "http" in (t.get("description") or ""))
print(("  ✅" if n>0 else "  ❌")+f" 工具數 {n}")
print(("  ✅" if ok==n and n>0 else "  ❌")+f" jobId 皆為 UUID {ok}/{n}")
print(("  ✅" if leak==0 else "  ❌")+f" 描述未洩漏來源網址（洩漏 {leak} 筆）")
PY

echo; echo "════ C. ask_data_source 邊界 ════"
R=$(curl -s --max-time 120 -X POST "$B/api/konect4ai/ask" -H "Content-Type: application/json" -d "{\"jobId\":\"$JOB\",\"question\":\"What is the largest earthquake?\"}")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'error' in d: print('  ❌ UUID 問答失敗:', str(d)[:100]); raise SystemExit
print(('  ✅' if d.get('answer') else '  ❌')+' 回傳答案')
rr=d.get('rawRows') or []
print(('  ✅' if len(rr)>0 else '  ❌')+f' 頁面拿到原始資料 {len(rr)} 筆')
rc=(d.get('receipt') or {})
print(('  ✅' if rc.get('rawRowsReturnedThroughWebMCP') is False else '  ❌')+' receipt 標示未經 WebMCP 回傳')
print(('  ✅' if rc.get('verifiedByBackend') else '  ❌')+' backend verified')
print(('  ✅' if rc.get('recordsConsulted') else '  ❌')+f\" recordsConsulted={rc.get('recordsConsulted')}\")
"
R=$(curl -s --max-time 120 -X POST "$B/api/konect4ai/ask" -H "Content-Type: application/json" -d '{"jobId":"usgs_earthquakes_past_24h_mag_2_5_fe6cf2a9","question":"largest earthquake?"}')
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(('  ✅' if d.get('answer') and len(d.get('rawRows') or [])>0 else '  ❌')+' 傳工具名稱也能解析且拿到資料')
"
R=$(curl -s --max-time 60 -X POST "$B/api/konect4ai/ask" -H "Content-Type: application/json" -d '{"jobId":"bogus-id","question":"x"}')
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin); j=json.dumps(d)
print(('  ✅' if 'error' in d and 'fe6cf2a9' in j else '  ❌')+' 亂碼 jobId 被擋且附可用清單')
"

echo; echo "════ D. A2A ════"
curl -s --max-time 40 "$B/.well-known/agent-card.json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(('  ✅' if d.get('url','').startswith('https://konect4ai-webmcp.vercel.app') else '  ❌')+f\" card.url={d.get('url')}\")
print(('  ✅' if len(d.get('capabilityMetadata') or [])>0 else '  ❌')+f\" 能力 {len(d.get('capabilityMetadata') or [])} 個\")
print(('  ✅' if len(d.get('skills') or [])==4 else '  ❌')+f\" skills {len(d.get('skills') or [])} 個\")
print(('  ✅' if d.get('protocolVersion')=='v1.0' else '  ❌')+f\" protocolVersion={d.get('protocolVersion')}\")
"
T=$(curl -s --max-time 180 -X POST "$B/a2a" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":"acc","method":"SendMessage","params":{"message":{"text":"What changed in the WebMCP spec?"}}}')
echo "$T" | python3 -c "
import json,sys
d=json.load(sys.stdin); r=d.get('result') or {}
print(('  ✅' if (r.get('task') or {}).get('state')=='completed' else '  ❌')+' SendMessage 完成')
print(r.get('taskId',''), file=open('/tmp/_tid','w'))
"
TID=$(cat /tmp/_tid 2>/dev/null)
[ -n "$TID" ] && curl -s --max-time 60 -X POST "$B/a2a" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":\"g\",\"method\":\"GetTask\",\"params\":{\"taskId\":\"$TID\"}}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(('  ✅' if 'result' in d else '  ❌')+' GetTask 取得任務')
"

echo; echo "════ E. 其他端點 ════"
curl -s --max-time 60 -X POST "$B/api/datagov/search" -H "Content-Type: application/json" -d '{"query":"earthquake","limit":3}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(('  ✅' if 'error' not in d else '  ❌')+' Data.gov 搜尋')
"
curl -s --max-time 40 -X POST "$B/api/konect4ai/sources" -H "Content-Type: application/json" -d '{}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(('  ✅' if 'error' in d else '  ❌')+' 建立來源端點會擋掉空請求')
"

echo; echo "════ F. 安全 ════"
ALL=$(curl -s --max-time 40 "$B/api/konect4ai/tools"; curl -s --max-time 40 "$B/.well-known/agent-card.json"; curl -s --max-time 30 "$B/")
echo "$ALL" | grep -qiE "sk-[a-zA-Z0-9]{15,}|eyJ[A-Za-z0-9_-]{30,}|VB-2T2R" && echo "  ❌ 回應中發現疑似密鑰" || echo "  ✅ 公開回應未含密鑰"
