# Pontilha

Editor de pixel art para Linux. Quem desenha pode ser você, com mouse ou mesa
digitalizadora, ou um agente de IA mandando comandos para a janela aberta, como nos
apps do ArtCraft. Nos dois casos, cada passo aparece na tela na hora.

## Usar

- Abrir: `pontilha` (ou pelo lançador de apps).
- Atalhos: B lápis, E borracha, L linha, U retângulo, G balde, I conta-gotas, X troca as
  cores, `[` e `]` mudam o pincel, Alt segurado pega uma cor, Espaço e arrastar move a
  tela, Ctrl+Z/Ctrl+Shift+Z desfazem e refazem, Ctrl+S salva, Ctrl+E exporta PNG.
- Formato próprio: `.pontilha` (camadas e paleta). PNG exportado sem borrar, em qualquer
  escala inteira.

## Controlar por agentes e terminal

Com a janela aberta, ela escuta em `127.0.0.1:7990` (porta e token publicados em
`~/.config/pontilha/`; desligue com `--no-control`).

- MCP: `pontilha mcp`, já registrado no Claude Code como `pontilha`. Ferramentas no padrão
  do ArtCraft: `command_list`, `command_run`, `command_batch`, `doc_new`, `doc_open`,
  `doc_place`, `doc_save`, `doc_export`, `doc_inspect`, `render_preview`, `app_open`.
- Terminal: `pontilha status`, `pontilha commands`, `pontilha run draw.rect '{"x":0,"y":0,"w":4,"h":4}'`,
  `pontilha run examples/badge-estrela.json`, `pontilha preview`, `pontilha export saida.png 4`.
- Skill: `~/.claude/skills/pontilha/SKILL.md`.

## Desenvolver

```sh
bun install
bunx tauri dev                 # janela com recarga automática
bun run test                   # motor de desenho e comandos
bunx tauri build --no-bundle   # binário final em src-tauri/target/release/pontilha
```

- `src/core/`: motor (pixels, rasterização, histórico, PNG, formato do projeto), sem DOM.
- `src/automation/commands.ts`: os comandos que agentes e scripts usam.
- `src/canvas/`, `src/ui/`: tela de desenho e painéis (React).
- `src-tauri/src/control.rs`: porta de controle; `cli.rs`: linha de comando e servidor MCP.
