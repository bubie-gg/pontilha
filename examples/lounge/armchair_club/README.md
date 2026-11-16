# Club armchair (Bubie Lounge)

A 1×1 mobi on 80 × 100 px, anchored at the center of the bottom edge (the front vertex of the diamond).
The root draws `armchair_club.1x1`, which faces +y (screen left). `x/` draws the version
that faces +x, rendered with mirrored light.

    pontilha run 0_setup.json 0.3          # document, iso grid 80, palette, layers
    pontilha run 1_s1_shapes.json 1        # volumes
    pontilha run 2_s2_light.json 1         # occlusion and contact
    pontilha run 3_s3_details.json 1       # tufting, buttons, piping, scrolls, grain
    pontilha run 4_s4_outline.json 1       # silhouette and seams

The generator and the quality bar live in Bubie:
`~/www/bubie/frontend/tools/furniture-study/` (`club_seating.py --seats 1 [--mirror]`, then
`recipes.py`) and `~/www/bubie/frontend/docs/development/furniture-quality.md`.
