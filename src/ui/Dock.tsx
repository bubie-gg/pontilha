import { useEffect, useRef, useState } from 'react';
import { checkerTile, layerCanvas } from '../canvas/layerCache';
import { toCss, toHex } from '../core/color';
import { actions, useApp } from '../state/store';
import { ColorPicker } from './ColorPicker';
import { IconButton, Section } from './controls';
import { Icon } from './icons';

function Preview() {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useApp((s) => `${s.doc.width} × ${s.doc.height}`);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const { doc } = useApp.getState();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const fit = Math.min(w / doc.width, h / doc.height);
      const scale = fit >= 1 ? Math.floor(fit) : fit;
      const dw = Math.round(doc.width * scale);
      const dh = Math.round(doc.height * scale);
      const x = Math.round((w - dw) / 2);
      const y = Math.round((h - dh) / 2);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      const pattern = ctx.createPattern(checkerTile(Math.max(3, Math.round(4 * dpr))), 'repeat')!;
      pattern.setTransform(new DOMMatrix([1, 0, 0, 1, x, y]));
      ctx.fillStyle = pattern;
      ctx.fillRect(x, y, dw, dh);
      for (const layer of doc.layers) {
        if (!layer.visible) continue;
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(layerCanvas(layer, doc.width, doc.height), x, y, dw, dh);
      }
      ctx.globalAlpha = 1;
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const unsubscribe = useApp.subscribe((s, prev) => {
      if (s.version !== prev.version || s.doc !== prev.doc) request();
    });
    const resize = new ResizeObserver(request);
    resize.observe(canvas);
    request();
    return () => {
      unsubscribe();
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <Section title="Prévia" actions={<span className="dock-meta">{size} px</span>}>
      <canvas ref={ref} className="preview" aria-label="Prévia da imagem no tamanho real" />
    </Section>
  );
}

function Palette() {
  const palette = useApp((s) => s.palette);
  const primary = useApp((s) => s.primary);
  const secondary = useApp((s) => s.secondary);
  const inPalette = palette.includes(primary);

  return (
    <Section
      title="Cores"
      actions={
        <div className="dock-actions">
          <IconButton size="sm" icon="plus" label="Adicionar a cor principal à paleta" onClick={() => actions.addToPalette(primary)} />
          <IconButton
            size="sm"
            icon="trash"
            label="Remover a cor principal da paleta"
            disabled={!inPalette}
            onClick={() => actions.removeFromPalette(primary)}
          />
        </div>
      }
    >
      <ColorPicker />
      <div className="swatches" role="group" aria-label="Paleta">
        {palette.map((c, i) => (
          <button
            key={`${i}-${c}`}
            type="button"
            className={`swatch${c === primary ? ' is-primary' : ''}${c === secondary ? ' is-secondary' : ''}`}
            style={{ '--swatch': toCss(c) } as React.CSSProperties}
            title={`${toHex(c)}. Clique: cor principal. Botão direito: secundária.`}
            aria-label={`Cor ${toHex(c)}`}
            aria-pressed={c === primary}
            onClick={() => actions.setPrimary(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              actions.setSecondary(c);
            }}
          />
        ))}
      </div>
    </Section>
  );
}

function LayerName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);

  if (!editing) {
    return (
      <span
        className="layer-name"
        title="Clique duas vezes para renomear"
        onDoubleClick={() => {
          setText(name);
          setEditing(true);
        }}
      >
        {name}
      </span>
    );
  }
  const done = (save: boolean) => {
    if (save) actions.renameLayer(id, text);
    setEditing(false);
  };
  return (
    <input
      className="layer-rename"
      value={text}
      autoFocus
      aria-label="Nome da camada"
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function Layers() {
  const layers = useApp((s) => s.doc.layers);
  const activeId = useApp((s) => s.activeLayerId);
  const active = layers.find((l) => l.id === activeId) ?? layers[layers.length - 1];
  const index = layers.indexOf(active);
  const dragFrom = useRef<number | null>(null);

  const startOpacity = () => {
    if (dragFrom.current === null) dragFrom.current = active.opacity;
  };
  const endOpacity = () => {
    if (dragFrom.current !== null) actions.commitOpacity(active.id, dragFrom.current);
    dragFrom.current = null;
  };

  return (
    <Section title="Camadas" actions={<span className="dock-meta">{layers.length}</span>}>
      <ol className="layers" aria-label="Camadas, a de cima primeiro">
        {[...layers].reverse().map((layer) => (
          <li
            key={layer.id}
            className={`layer${layer.id === active.id ? ' is-active' : ''}${layer.visible ? '' : ' is-hidden'}`}
            onClick={() => actions.setActiveLayer(layer.id)}
          >
            <button
              type="button"
              className="layer-eye"
              aria-label={layer.visible ? `Ocultar ${layer.name}` : `Mostrar ${layer.name}`}
              title={layer.visible ? 'Ocultar camada' : 'Mostrar camada'}
              onClick={(e) => {
                e.stopPropagation();
                actions.toggleVisibility(layer.id);
              }}
            >
              <Icon name={layer.visible ? 'eye' : 'eyeClosed'} size={12} />
            </button>
            <LayerName id={layer.id} name={layer.name} />
            <span className="layer-opacity">{Math.round(layer.opacity * 100)}%</span>
          </li>
        ))}
      </ol>

      <label className="opacity-field">
        <span className="option-label">Opacidade de {active.name}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(active.opacity * 100)}
          onPointerDown={startOpacity}
          onKeyDown={startOpacity}
          onChange={(e) => {
            startOpacity();
            actions.previewOpacity(active.id, Number(e.target.value) / 100);
          }}
          onPointerUp={endOpacity}
          onKeyUp={endOpacity}
          onBlur={endOpacity}
        />
      </label>

      <div className="layer-actions">
        <IconButton icon="plus" label="Nova camada" onClick={() => actions.addLayer()} />
        <IconButton icon="duplicate" label="Duplicar camada" onClick={actions.duplicateLayer} />
        <IconButton icon="up" label="Subir camada" disabled={index === layers.length - 1} onClick={() => actions.moveLayer(1)} />
        <IconButton icon="down" label="Descer camada" disabled={index === 0} onClick={() => actions.moveLayer(-1)} />
        <IconButton icon="merge" label="Mesclar com a camada de baixo" disabled={index === 0} onClick={actions.mergeDown} />
        <IconButton icon="trash" label="Excluir camada" disabled={layers.length === 1} onClick={actions.deleteLayer} />
      </div>
    </Section>
  );
}

export function Dock() {
  return (
    <aside className="dock" aria-label="Painéis">
      <Preview />
      <Palette />
      <Layers />
    </aside>
  );
}
