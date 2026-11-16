export const PANEL_CSS = `
:host { all: initial; }
.rb {
  --bg:#0b1622; --panel:#0f1d2b; --line:#1c2e40; --text:#e6edf3; --muted:#7d8fa3;
  --green:#2ecc71; --red:#e5484d; --orange:#f59e0b; --blue:#3b82f6; --cyan:#38bdf8;
  position: fixed; top: 80px; right: 24px; width: 760px; max-width: calc(100vw - 32px);
  min-width: 320px; min-height: 120px; resize: both; overflow: hidden;
  background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 10px;
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-variant-numeric: tabular-nums; box-shadow: 0 12px 32px rgba(0,0,0,.45);
  z-index: 2147483646; display: flex; flex-direction: column;
}
.rb.min .body, .rb.min .status, .rb.min .footer { display: none; }
.sec { margin:12px 0 6px; color:var(--cyan); font-size:11.5px; }
.sec:first-child { margin-top:0; }
.rb.min { min-height: 0; resize: none; }
.hdr { display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--panel);
  border-bottom:1px solid var(--line); cursor:move; user-select:none; }
.title { font-weight:700; color:var(--cyan); }
.ver { color:var(--muted); font-size:11px; }
.sub { color:var(--muted); font-size:11px; margin-left:4px; }
.sp { flex:1; }
button { font:inherit; color:var(--text); background:transparent; border:1px solid var(--line);
  border-radius:6px; padding:2px 8px; cursor:pointer; }
button:hover { border-color: var(--cyan); }
button.on { background: var(--line); color: var(--cyan); }
.status { display:flex; flex-wrap:wrap; gap:6px; padding:5px 10px; color:var(--muted);
  font-size:11px; border-bottom:1px solid var(--line); }
.live { color: var(--green); font-weight:600; }
.paused { color: var(--orange); font-weight:600; }
.warn { color: var(--orange); }
.tabs { display:flex; gap:4px; padding:6px 10px; flex-wrap:wrap; border-bottom:1px solid var(--line); }
.tabs button { border-radius: 4px; font-size: 11px; }
.body { flex:1; overflow:auto; padding:10px; }
.empty { color: var(--muted); text-align:center; padding: 24px 8px; }
table { width:100%; border-collapse:collapse; font-size:inherit; color:inherit; }
th { color:var(--muted); font-weight:600; font-size:10.5px; text-align:right; padding:4px 6px; border-bottom:1px solid var(--line); }
td { text-align:right; padding:4px 6px; border-bottom:1px solid var(--line); }
th:first-child, td.code { text-align:left; }
td.code { font-weight:700; color:var(--cyan); }
.up { color: var(--green); } .down { color: var(--red); }
tr.bad td { opacity:.5; }
th.l, td.l { text-align:left; }
td { vertical-align: middle; }
.code { font-weight:700; color:var(--cyan); cursor:pointer; }
.small { font-size:10px; color:var(--muted); margin-top:2px; }
.muted { color: var(--muted); }
.badge { display:inline-block; font-size:10px; font-weight:700; padding:1px 6px; border-radius:999px; margin-left:4px; border:1px solid var(--line); }
td.l > .badge:first-child { margin-left:0; }
.b-green { background:rgba(46,204,113,.15); color:var(--green); border-color:rgba(46,204,113,.4); }
.b-red { background:rgba(229,72,77,.15); color:var(--red); border-color:rgba(229,72,77,.4); }
.b-orange { background:rgba(245,158,11,.15); color:var(--orange); border-color:rgba(245,158,11,.4); }
.b-blue { background:rgba(59,130,246,.15); color:var(--blue); border-color:rgba(59,130,246,.4); }
.b-grey { color:var(--muted); }
.b-old { opacity:.5; }
.b-star { background:rgba(59,130,246,.2); color:#c7d2fe; border-color:rgba(99,102,241,.5); }
.w-bar { min-width:150px; }
.bvj { display:flex; justify-content:space-between; font-size:10.5px; font-weight:600; }
.bar { height:5px; background:var(--red); border-radius:3px; overflow:hidden; margin-top:3px; }
.bar i { display:block; height:100%; background:var(--green); }
.note { color:var(--muted); font-size:10.5px; margin-top:6px; }
.footer { padding:6px 10px; color:var(--muted); font-size:10.5px; border-top:1px solid var(--line); }
`;
