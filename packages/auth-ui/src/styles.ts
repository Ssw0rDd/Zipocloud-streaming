export const authStyles = `
:host {
  --za-ink: #08090b;
  --za-carbon: #13151a;
  --za-panel: #1a1d23;
  --za-line: #30343d;
  --za-signal: #ff304f;
  --za-signal-hot: #ff5a70;
  --za-paper: #f4efea;
  --za-muted: #a6a8af;
  --za-display: "Bricolage Grotesque", "Arial Narrow", sans-serif;
  --za-body: "Manrope", "Trebuchet MS", sans-serif;
  color: var(--za-paper);
  display: block;
  font-family: var(--za-body);
}

* { box-sizing: border-box; }

.shell {
  background: var(--za-ink);
  border: 1px solid var(--za-line);
  border-radius: 18px 5px 18px 5px;
  box-shadow: 0 30px 90px rgb(0 0 0 / 0.45);
  inline-size: min(100%, 430px);
  min-block-size: 560px;
  overflow: hidden;
  padding: clamp(24px, 7vw, 42px);
  position: relative;
}

.shell::before {
  background: linear-gradient(180deg, transparent, var(--za-signal), transparent);
  content: "";
  inset-block: -30%;
  inline-size: 1px;
  opacity: 0.7;
  pointer-events: none;
  position: absolute;
  transform: translateX(-80px) rotate(11deg);
  animation: za-scan 900ms cubic-bezier(.16, 1, .3, 1) both;
}

.masthead { margin-block-end: 34px; position: relative; }
.eyebrow {
  align-items: center;
  color: var(--za-signal-hot);
  display: flex;
  font: 700 11px/1 var(--za-body);
  gap: 9px;
  letter-spacing: .19em;
  margin: 0 0 13px;
  text-transform: uppercase;
}
.eyebrow::before { background: var(--za-signal); content: ""; block-size: 18px; inline-size: 2px; }
h1 {
  font: 720 clamp(32px, 9vw, 48px)/.93 var(--za-display);
  letter-spacing: -.045em;
  margin: 0;
  max-inline-size: 8ch;
}
.intro { color: var(--za-muted); font-size: 14px; line-height: 1.55; margin: 16px 0 0; max-inline-size: 34ch; }

.tabs { border-block-end: 1px solid var(--za-line); display: flex; gap: 22px; margin-block-end: 26px; }
.tab {
  background: transparent;
  border: 0;
  color: var(--za-muted);
  cursor: pointer;
  font: 700 12px/1 var(--za-body);
  letter-spacing: .08em;
  padding: 0 0 13px;
  position: relative;
  text-transform: uppercase;
}
.tab[aria-selected="true"] { color: var(--za-paper); }
.tab[aria-selected="true"]::after { background: var(--za-signal); block-size: 2px; content: ""; inset: auto 0 -1px; position: absolute; }

form { display: grid; gap: 17px; }
label { color: var(--za-muted); display: grid; font-size: 12px; font-weight: 650; gap: 8px; letter-spacing: .035em; }
input {
  appearance: none;
  background: var(--za-carbon);
  border: 1px solid var(--za-line);
  border-radius: 8px 2px 8px 2px;
  color: var(--za-paper);
  font: 500 15px/1.2 var(--za-body);
  min-block-size: 50px;
  outline: none;
  padding: 0 15px;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
input:hover { border-color: #494e59; }
input:focus-visible { border-color: var(--za-signal); box-shadow: 0 0 0 3px rgb(255 48 79 / .18); }

.action {
  align-items: center;
  background: var(--za-signal);
  border: 0;
  border-radius: 8px 2px 8px 2px;
  color: #200309;
  cursor: pointer;
  display: inline-flex;
  font: 800 13px/1 var(--za-body);
  justify-content: space-between;
  letter-spacing: .075em;
  margin-block-start: 5px;
  min-block-size: 52px;
  padding: 0 17px;
  text-transform: uppercase;
  transition: background 160ms ease, transform 160ms ease;
}
.action::after { content: "→"; font-size: 20px; font-weight: 500; }
.action:hover { background: var(--za-signal-hot); transform: translateY(-1px); }
.action:active { transform: translateY(0) scale(.99); }
.action:focus-visible, .tab:focus-visible { outline: 2px solid var(--za-paper); outline-offset: 3px; }
.action:disabled { cursor: wait; opacity: .65; transform: none; }

.status { color: #ff8b9a; font-size: 13px; line-height: 1.45; margin: 0; min-block-size: 19px; }
.fine-print { color: #777b84; font-size: 11px; line-height: 1.45; margin: 22px 0 0; }

@keyframes za-scan { from { inset-inline-start: 0; opacity: 0; } to { inset-inline-start: 100%; opacity: .7; } }

@media (max-width: 460px) {
  .shell { border-inline: 0; border-radius: 0; inline-size: 100%; min-block-size: 100dvh; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
