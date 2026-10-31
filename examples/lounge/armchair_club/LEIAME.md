# Poltrona clube (Lounge do Bubie)

Mobi 1×1 em 80 × 100 px, âncora no centro da borda de baixo (vértice da frente do losango).
A raiz desenha `armchair_club.1x1`, que olha para +y (esquerda da tela). `x/` desenha a versão
que olha para +x, renderizada com a luz espelhada.

    pontilha run 0_setup.json 0.3          # documento, grade iso 80, paleta, camadas
    pontilha run 1_s1_formas.json 1        # volumes
    pontilha run 2_s2_luz.json 1           # oclusão e contato
    pontilha run 3_s3_detalhes.json 1      # capitonê, botões, vivo, espirais, veio
    pontilha run 4_s4_contorno.json 1      # silhueta e costuras

O gerador e o padrão de qualidade ficam no Bubie:
`~/www/bubie/frontend/tools/furniture-study/` (`club_seating.py --seats 1 [--mirror]`, depois
`recipes.py`) e `~/www/bubie/frontend/docs/development/furniture-quality.md`.
