# Pontilha

Editor de pixel art para Linux. Quem desenha pode ser você, com mouse ou mesa
digitalizadora, ou um agente de IA mandando comandos para a janela aberta, como nos
apps do ArtCraft. Nos dois casos, cada passo aparece na tela na hora.

## Usar

- Abrir: `pontilha` (ou pelo lançador de apps).
- Atalhos: M seleção, B lápis, E borracha, L linha, U retângulo, G balde, I conta-gotas, X troca as
  cores, `[` e `]` mudam o pincel, Alt segurado pega uma cor, Espaço e arrastar move a
  tela, Ctrl+Z/Ctrl+Shift+Z desfazem e refazem, Ctrl+S salva, Ctrl+E exporta (PNG, folha de sprites ou GIF).
- Formato próprio: `.pontilha` (camadas, quadros e paleta). PNG exportado sem borrar, em
  qualquer escala inteira.

## Tamanho da imagem

O botão de recorte na barra de cima abre Tamanho da imagem. Tudo vale para todas as camadas e
quadros, e Ctrl+Z desfaz:

- Tela: nova largura e altura sem esticar a arte; os 9 quadradinhos escolhem onde a imagem
  atual fica. Encolher corta o que não couber.
- Ampliar: cada pixel vira um bloco 2×, 3×, 4× ou 8×.
- Recortar: cortar as bordas vazias em volta da arte, ou recortar na seleção (também na
  barra da ferramenta Seleção).

## Seleção

Com a ferramenta de seleção (M), arraste para selecionar um retângulo e arraste dentro
dele para mover os pixels. A barra de opções e os atalhos agem na seleção, ou na camada
inteira quando nada está selecionado:

- Com algo selecionado, setas movem 1 px (Shift+setas, 8 px). Shift+H e Shift+V espelham; Shift+R gira 90°.
- Ctrl+C copia, Ctrl+X recorta, Ctrl+V cola no mesmo lugar de onde copiou (bom para levar
  uma parte para outro quadro). Delete apaga; Ctrl+A seleciona tudo; Ctrl+D ou Esc desmarca.
- Desfazer devolve os pixels e a seleção juntos.

## Animar

A linha do tempo fica embaixo da tela. Cada quadro tem uma imagem por camada e a própria
duração em milissegundos.

- `+` cria um quadro vazio, o botão de duplicar copia o atual, a lixeira exclui.
- Arraste uma miniatura para reordenar (ou Shift+setas com ela selecionada).
- `,` e `.` passam de quadro; Enter toca e pausa, em Repetir ou Ida e volta.
- Papel vegetal mostra o quadro anterior e o seguinte por baixo, bem claros.
- Projetos da versão 1 (sem quadros) continuam abrindo; ao salvar viram versão 2.
- Exportar (Ctrl+E): o quadro atual em PNG, todos os quadros numa folha de sprites (em
  linha ou em grade) ou um GIF animado que repete para sempre, com ida e volta opcional.
  GIF guarda até 256 cores e cada pixel é opaco ou transparente.

## Controlar por agentes e terminal

Com a janela aberta, ela escuta em `127.0.0.1:7990` (porta e token publicados em
`~/.config/pontilha/`; desligue com `--no-control`).

- MCP: `pontilha mcp`, já registrado no Claude Code como `pontilha`. Ferramentas no padrão
  do ArtCraft: `command_list`, `command_run`, `command_batch`, `doc_new`, `doc_open`,
  `doc_place`, `doc_save`, `doc_export`, `doc_inspect`, `render_preview`, `app_open`.
- Terminal: `pontilha status`, `pontilha commands`, `pontilha run draw.rect '{"x":0,"y":0,"w":4,"h":4}'`,
  `pontilha run examples/badge-estrela.json`, `pontilha preview`, `pontilha export saida.png 4`,
  `pontilha export folha.png 4 grid`, `pontilha export anim.gif 4 pingpong`.
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
