import { useEffect, useRef, useState, type ReactNode } from "react";
import { Crosshair, Heart, Pause, RotateCcw, Users, Volume2, VolumeX } from "lucide-react";
import { BLOCKS, WORLD } from "@/game/layout";
import { INITIAL_HUD, type HudSnapshot } from "@/game/types";

type Game = {
  start: () => void;
  pause: () => void;
  resume: () => void;
  tryLock: () => void;
  toggleMute: () => void;
  setFire: (held: boolean) => void;
  setPedal: (which: "gas" | "brake", held: boolean) => void;
  setTouchMove: (x: number, y: number) => void;
  addLook: (dx: number, dy: number) => void;
  requestReload: () => void;
  cycleWeapon: () => void;
  toggleVehicle: () => void;
  destroy: () => void;
  audio: { resumeIfNeeded: () => void };
};

export function PortCendre() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const stick = useRef({ id: -1, x: 0, y: 0 });
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [fail, setFail] = useState("");

  useEffect(() => {
    let game: Game | null = null;
    let cancel = false;
    void import("@/game/PortGame")
      .then(({ PortGame }) => {
        if (cancel || !canvasRef.current) return;
        game = new PortGame(canvasRef.current, { onHud: setHud });
        gameRef.current = game;
      })
      .catch((error: unknown) => {
        if (!cancel) setFail(error instanceof Error ? error.message : "WebGL indisponible");
      });
    const onVis = () => {
      if (!document.hidden) gameRef.current?.audio.resumeIfNeeded();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancel = true;
      document.removeEventListener("visibilitychange", onVis);
      game?.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = mapRef.current;
    if (!canvas || hud.mode === "menu") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#12161c";
    ctx.fillRect(0, 0, size, size);
    const project = (x: number, z: number) =>
      [((x + WORLD) / (WORLD * 2)) * size, ((z + WORLD) / (WORLD * 2)) * size] as const;
    ctx.fillStyle = "#2c343e";
    for (const block of BLOCKS) {
      const [x, y] = project(block.x - block.hw, block.z - block.hd);
      const [x2, y2] = project(block.x + block.hw, block.z + block.hd);
      ctx.fillRect(x, y, Math.max(1, x2 - x), Math.max(1, y2 - y));
    }
    for (const blip of hud.blips) {
      const [x, y] = project(blip.x, blip.z);
      ctx.fillStyle = blip.k === "h" ? "#c44536" : blip.k === "m" ? "#e2a04a" : "#e7e1d6";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    const [px, py] = project(hud.px, hud.pz);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-hud.pyaw);
    ctx.fillStyle = "#e2a04a";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }, [hud]);

  const compact = hud.coarse || !hud.locked;
  const showTouch = hud.mode === "play" && compact;
  const low = hud.health <= 30;

  function enter() {
    const game = gameRef.current;
    if (!game) return;
    game.start();
    game.tryLock();
  }

  return (
    <div className="fixed inset-0 touch-none overflow-hidden bg-bg text-fg select-none" onContextMenu={(event) => event.preventDefault()}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="vignette pointer-events-none absolute inset-0" />
      <div className="damage-veil pointer-events-none absolute inset-0" style={{ opacity: hud.damage * 0.7 }} />

      {hud.mode === "play" && !hud.riding && <Cross />}

      {hud.mode !== "menu" && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pb-2"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="min-w-0">
            <p className="font-display text-xs tracking-widest text-primary">VAGUE {String(hud.wave).padStart(2, "0")}</p>
            <p className="font-display text-3xl leading-none">{hud.score}</p>
            {hud.riding && (
              <p className="mt-1 font-display text-2xl leading-none">
                {hud.kmh}
                <span className="ml-1 text-xs text-muted">km/h</span>
              </p>
            )}
            <p className="mt-1 flex items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <Crosshair className="size-3.5" aria-hidden="true" />
                {hud.hostiles}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden="true" />
                {hud.civils}
              </span>
            </p>
            {compact && (
              <div className="mt-2 w-36">
                <div className="mb-1 flex items-center justify-between text-xs tracking-widest text-muted uppercase">
                  <span className="inline-flex items-center gap-1">
                    <Heart className="size-3.5 text-primary" aria-hidden="true" />
                    Santé
                  </span>
                  <span className="font-display text-fg">{Math.ceil(hud.health)}</span>
                </div>
                <div className="h-2 bg-border">
                  <div className={low ? "h-full bg-danger" : "h-full bg-primary"} style={{ width: `${Math.max(0, hud.health)}%` }} />
                </div>
                {hud.mode === "play" && !hud.riding && (
                  <p className="mt-2 font-display text-xs tracking-widest text-primary uppercase">
                    {hud.weapon} {hud.mag}/{hud.reserve}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-start gap-2">
            <canvas
              ref={mapRef}
              width={160}
              height={160}
              className={compact ? "h-16 w-16 border border-border bg-bg" : "h-24 w-24 border border-border bg-bg"}
              aria-hidden="true"
            />
            <div className="pointer-events-auto flex flex-col gap-2">
              <IconButton label={hud.muted ? "Activer le son" : "Couper le son"} onClick={() => gameRef.current?.toggleMute()}>
                {hud.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </IconButton>
              {hud.mode === "play" && (
                <IconButton label="Pause" onClick={() => gameRef.current?.pause()}>
                  <Pause className="size-5" />
                </IconButton>
              )}
            </div>
          </div>
        </div>
      )}

      {hud.message && hud.mode !== "menu" && (
        <p className="pointer-events-none absolute top-44 left-1/2 w-52 -translate-x-1/2 text-center font-display text-sm tracking-widest text-primary uppercase">
          {hud.message}
        </p>
      )}

      {hud.mode !== "menu" && !compact && (
        <div className="pointer-events-none absolute bottom-4 left-4 w-64">
          <div className="mb-2 flex items-center justify-between text-xs tracking-widest text-muted uppercase">
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3.5 text-primary" aria-hidden="true" />
              Santé
            </span>
            <span className="font-display text-fg">{Math.ceil(hud.health)}</span>
          </div>
          <div className="h-2 bg-border">
            <div className={low ? "h-full bg-danger" : "h-full bg-primary"} style={{ width: `${Math.max(0, hud.health)}%` }} />
          </div>
        </div>
      )}

      {hud.mode === "play" && hud.riding && !compact && (
        <p className="pointer-events-none absolute top-28 left-1/2 -translate-x-1/2 font-display text-5xl leading-none tracking-wide">
          {hud.kmh}
          <span className="ml-2 text-base text-muted">km/h</span>
        </p>
      )}

      {hud.mode === "play" && hud.nearCar && !showTouch && (
        <p className="pointer-events-none absolute bottom-36 left-1/2 -translate-x-1/2 font-display text-sm tracking-widest text-primary uppercase">
          F · monter
        </p>
      )}

      {hud.mode === "play" && !hud.riding && !compact && (
        <div className="pointer-events-none absolute right-4 bottom-4 w-40 text-right">
          <p className="font-display text-xs tracking-widest text-primary uppercase">{hud.weapon}</p>
          <p className="font-display text-4xl leading-none">
            {hud.mag}
            <span className="text-lg text-muted">/{hud.reserve}</span>
          </p>
          {hud.reloading > 0 && (
            <div className="mt-2 ml-auto h-1 w-full bg-border">
              <div className="h-full bg-primary" style={{ width: `${hud.reloading * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {showTouch && (
        <div
          className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-4"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          <div
            className="relative h-36 w-36 shrink-0 rounded-full border border-border bg-bg/80"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              stick.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            }}
            onPointerMove={(event) => {
              if (event.pointerId !== stick.current.id) return;
              const max = 52;
              let dx = event.clientX - stick.current.x;
              let dy = event.clientY - stick.current.y;
              const len = Math.hypot(dx, dy) || 1;
              const clipped = Math.min(max, len);
              dx = (dx / len) * clipped;
              dy = (dy / len) * clipped;
              setKnob({ x: dx, y: dy });
              gameRef.current?.setTouchMove(dx / max, -dy / max);
            }}
            onPointerUp={(event) => {
              if (event.pointerId !== stick.current.id) return;
              stick.current.id = -1;
              setKnob({ x: 0, y: 0 });
              gameRef.current?.setTouchMove(0, 0);
            }}
            onPointerCancel={() => {
              stick.current.id = -1;
              setKnob({ x: 0, y: 0 });
              gameRef.current?.setTouchMove(0, 0);
            }}
          >
            <span
              className="absolute top-1/2 left-1/2 h-14 w-14 rounded-full bg-primary"
              style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
            />
          </div>
          <div className="flex flex-col items-end gap-2">
            {hud.riding ? (
              <>
                <HoldButton label="Gaz" onHold={(held) => gameRef.current?.setPedal("gas", held)} />
                <HoldButton label="Frein" onHold={(held) => gameRef.current?.setPedal("brake", held)} />
                <TouchButton label="Sortir" onClick={() => gameRef.current?.toggleVehicle()} />
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-primary font-display text-xs tracking-widest text-bg uppercase"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    gameRef.current?.setFire(true);
                  }}
                  onPointerUp={() => gameRef.current?.setFire(false)}
                  onPointerCancel={() => gameRef.current?.setFire(false)}
                >
                  Tir
                </button>
                <TouchButton label="Charger" onClick={() => gameRef.current?.requestReload()} />
                <TouchButton label="Arme" onClick={() => gameRef.current?.cycleWeapon()} />
                <TouchButton label={hud.nearCar ? "Monter" : "Auto"} onClick={() => gameRef.current?.toggleVehicle()} />
              </>
            )}
          </div>
        </div>
      )}

      {hud.mode === "menu" && (
        <div className="absolute inset-0 flex items-end p-4 sm:items-center sm:p-10">
          <aside className="w-full max-w-md border border-border bg-bg/95 p-6 sm:p-8">
            <p className="font-display text-xs tracking-widest text-primary">QUARTIER DE NUIT</p>
            <h1 className="mt-2 font-display text-5xl leading-none tracking-wide sm:text-6xl">PORT-CENDRE</h1>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-muted">
              Une berline sur le quai, des rues mouillées, des brassards ambre. Tu conduis, tu descends, tu tires.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-fg">
              <li>Stick gauche : accélérer, freiner, tourner. Ou les boutons Gaz et Frein.</li>
              <li>Glisse l’écran pour regarder. Sortir, puis Tir.</li>
              <li>Clavier : WASD, A gauche, D droite, F pour descendre.</li>
            </ul>
            <p className="mt-4 text-xs text-muted">Fiction originale. Épargne les civils — un civil abattu retire des points.</p>
            {hud.best > 0 && <p className="mt-3 font-display text-sm tracking-widest text-primary">RECORD {hud.best}</p>}
            {fail && <p className="mt-3 text-sm text-danger">{fail}</p>}
            {hud.ready ? (
              <button type="button" className="mt-6 bg-primary px-5 py-3 font-display text-sm tracking-widest text-bg uppercase" onClick={enter}>
                Prendre le volant
              </button>
            ) : (
              <p className="mt-6 font-display text-sm tracking-widest text-muted">Chargement du port…</p>
            )}
          </aside>
        </div>
      )}

      {(hud.mode === "pause" || hud.mode === "dead") && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/70 p-4">
          <div className="w-full max-w-sm border border-border bg-bg p-6">
            <p className="font-display text-xs tracking-widest text-primary">{hud.mode === "dead" ? "QUAI PERDU" : "EN PAUSE"}</p>
            <h2 className="mt-2 font-display text-4xl tracking-wide">{hud.mode === "dead" ? "À terre" : "Pause"}</h2>
            <p className="mt-3 text-sm text-muted">
              Score {hud.score} · record {hud.best} · vague {hud.wave}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {hud.mode === "pause" && (
                <button type="button" className="bg-primary px-5 py-3 font-display text-sm tracking-widest text-bg uppercase" onClick={() => gameRef.current?.resume()}>
                  Reprendre
                </button>
              )}
              <button type="button" className="border border-border px-5 py-3 font-display text-sm tracking-widest text-fg uppercase" onClick={enter}>
                <RotateCcw className="mr-2 inline size-4" aria-hidden="true" />
                Recommencer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Cross() {
  const arm = "absolute bg-fg";
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
      <span className={`${arm} top-0 left-1/2 h-2 w-px -translate-x-1/2`} />
      <span className={`${arm} bottom-0 left-1/2 h-2 w-px -translate-x-1/2`} />
      <span className={`${arm} top-1/2 left-0 h-px w-2 -translate-y-1/2`} />
      <span className={`${arm} top-1/2 right-0 h-px w-2 -translate-y-1/2`} />
      <span className="absolute top-1/2 left-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 bg-primary" />
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} className="flex h-11 w-11 items-center justify-center border border-border bg-bg text-fg" onClick={onClick}>
      {children}
    </button>
  );
}

function TouchButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex h-14 min-w-14 items-center justify-center border border-border bg-bg px-2 font-display text-xs tracking-wide text-fg uppercase"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function HoldButton({ label, onHold }: { label: string; onHold: (held: boolean) => void }) {
  return (
    <button
      type="button"
      className="flex h-16 w-16 items-center justify-center rounded-full bg-primary font-display text-xs tracking-widest text-bg uppercase"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
    >
      {label}
    </button>
  );
}
