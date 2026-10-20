"""Export private captures to local CSV and an offline interactive memory chart.

No network, dependencies or device connection. Break lines at missing samples;
keep PID and metric accounting separate. Markers are delayed operator reports.
"""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
METRICS = ("physFootprint", "memResidentSize", "memVirtualSize", "memCompressed", "memRPrvt", "memRShrd")


def private_path(value):
    path = Path(value).resolve()
    path.relative_to((ROOT / ".local").resolve())
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", nargs="+", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = private_path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    runs, csv_rows, series, marks = [], [], {}, []
    for value in args.runs:
        folder = private_path(value)
        summary = json.loads((folder / "summary.private.json").read_text(encoding="utf-8"))
        context = json.loads((folder / "context.private.json").read_text(encoding="utf-8"))
        rows = [json.loads(line) for line in (folder / "samples.private.jsonl").read_text(encoding="utf-8").splitlines()]
        origin = summary["clock_origin_monotonic_ms"]
        t0 = runs[0]["origin_ms"] if runs else origin
        initial = {p["pid"] for p in json.loads((folder / "processes-before.private.json").read_text(encoding="utf-8"))}
        runs.append({"run": folder.name, "origin_ms": origin, "start_s": (origin-t0)/1000,
                     "end_s": (origin-t0+rows[-1]["elapsed_ms"])/1000 if rows else (origin-t0)/1000,
                     "samples": len(rows), "complete": summary["capture_complete"],
                     "cleanup": summary["cleanup_confirmed"], "actual_mode": context["actual_mode"]})
        marker = folder / "markers.private.jsonl"
        if marker.exists():
            marks.extend({"run": folder.name, "s": (m["monotonic_ms"]-t0)/1000,
                          "phase": m["phase"], "source": m["source"]}
                         for m in map(json.loads, marker.read_text(encoding="utf-8").splitlines()))
        for sequence, row in enumerate(rows):
            seconds = (origin-t0+row["elapsed_ms"])/1000
            for p in row["processes"]:
                csv_rows.append({"run": folder.name, "seconds": seconds, "pid": p["pid"], "name": p.get("name"),
                                 **{key: p.get(key) for key in METRICS}, "cpuUsage": p.get("cpuUsage")})
                key = f'{folder.name}:{p["pid"]}'
                slot = series.setdefault(key, {"run": folder.name, "pid": p["pid"], "name": p.get("name"),
                                             "new_since_before": p["pid"] not in initial, "points": []})
                slot["points"].append([seconds, *[p.get(key) for key in METRICS], sequence])
    fields = ["run", "seconds", "pid", "name", *METRICS, "cpuUsage"]
    with (out / "metrics.private.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(csv_rows)
    payload = {"runs": runs, "series": list(series.values()), "markers": marks, "metrics": METRICS}
    (out / "index.private.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    encoded = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")
    html = '''<!doctype html><meta charset="utf-8"><title>Local iOS process memory</title>
<style>body{font:15px system-ui;margin:24px;color:#17243b;background:#f8fafc}svg{background:white;border:1px solid #ccd6e2;width:100%;height:auto}label{display:inline-block;margin:6px}small{color:#526078}#legend{max-height:180px;overflow:auto}text{font:12px system-ui}</style>
<h2>本地 iOS 进程内存曲线</h2><p>单位 MiB（1,048,576 字节）。各 PID 和指标独立显示，不相加。新进程仅为候选；不能按大小认定归属。缺样与采集间隔不连线。</p>
<p>竖线为用户反馈记录时间，可能晚于实际操作；曲线时间为主机接收时间。运行模式见各段context，未知时不由配置推断。屏幕帧率另存，不能当游戏 FPS。</p>
<select id="metric"></select><svg id="chart" viewBox="0 0 1200 430"></svg><div id="legend"></div><small id="info"></small>
<script>const data=PAYLOAD;const colors=['#1864ab','#e8590c','#2b8a3e','#862e9c','#c2255c','#087f8c','#5c7cfa'];
const selected=new Set();const legend=document.getElementById('legend');const menu=document.getElementById('metric');
data.metrics.forEach(m=>{const o=document.createElement('option');o.textContent=m;menu.append(o)});
data.series.forEach((s,i)=>{if(s.name==='WeChat'||s.new_since_before)selected.add(i);const l=document.createElement('label');const c=document.createElement('input');c.type='checkbox';c.checked=selected.has(i);c.onchange=()=>{c.checked?selected.add(i):selected.delete(i);draw()};l.append(c,document.createTextNode(`${s.run} PID ${s.pid} ${s.name}${s.new_since_before?' [new candidate]':''}`));l.style.color=colors[i%colors.length];legend.append(l)});
const svg=document.getElementById('chart');function el(n,a,t){const x=document.createElementNS('http://www.w3.org/2000/svg',n);Object.entries(a).forEach(([k,v])=>x.setAttribute(k,v));if(t)x.textContent=t;svg.append(x);return x}
function draw(){svg.replaceChildren();const m=menu.selectedIndex+1;const all=data.series.filter((s,i)=>selected.has(i)).flatMap(s=>s.points.map(p=>p[m]).filter(v=>Number.isFinite(v)));const max=Math.max(1,...all)/1048576*1.08;const xmax=Math.max(1,...data.runs.map(r=>r.end_s));const x=v=>65+v/xmax*1100;const y=v=>370-v/1048576/max*330;
for(let i=0;i<=5;i++){const yy=370-i*66;el('line',{x1:65,y1:yy,x2:1165,y2:yy,stroke:'#e2e8f0'});el('text',{x:8,y:yy+4},(max*i/5).toFixed(0)+' MiB');el('text',{x:x(xmax*i/5)-12,y:397},(xmax*i/5).toFixed(0)+' s')}
data.runs.forEach(r=>el('text',{x:x(r.start_s)+3,y:420},r.run));
data.markers.forEach((v,i)=>{el('line',{x1:x(v.s),x2:x(v.s),y1:28,y2:370,stroke:'#94a3b8','stroke-dasharray':'4 5'});el('text',{x:x(v.s)+2,y:18+(i%2)*14},v.phase)});
data.series.forEach((s,i)=>{if(!selected.has(i))return;let path='',last=null,lastSequence=null;for(const p of s.points){if(!Number.isFinite(p[m])){last=null;continue}const sequence=p.at(-1);path+=(last===null||p[0]-last>2||sequence-lastSequence!==1?'M':'L')+x(p[0]).toFixed(2)+','+y(p[m]).toFixed(2);last=p[0];lastSequence=sequence}el('path',{d:path,fill:'none',stroke:colors[i%colors.length],'stroke-width':2})});document.getElementById('info').textContent=data.runs.map(r=>`${r.run}: ${r.samples} batches, complete=${r.complete}, cleanup=${r.cleanup}, mode=${r.actual_mode}`).join(' | ')}menu.onchange=draw;draw();</script>'''
    (out / "memory.private.html").write_text(html.replace("PAYLOAD", encoded), encoding="utf-8")
    print(json.dumps({"runs": len(runs), "rows": len(csv_rows), "series": len(series), "out": str(out)}))


if __name__ == "__main__":
    main()

