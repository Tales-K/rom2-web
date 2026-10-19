"""Estados derivados do ORIGINAL com TODOS os locais do mapa-mundi na lista (frente FIDELIDADE-RESTO, 19/10).

    python build_map_states.py

`kaarg_all` (de kaarg_30) e `druids_all` (de druids_60): mesmo estagio, mas a lista de locais disponiveis = a cidade + todas as missoes
conhecidas (states.MISSION_POS). Servem para clicar no portao e passar o mouse em cada bandeira do mapa Yases (trilha, titulo e descricao
de cada destino; tools/refcap/map_specs.py). So o mapa e a cidade carregam: missoes derivadas nao servem (notes/original-capture.md).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import states  # noqa: E402

TOWN_LOC = {"kaarg": (2, 2, 370, 305), "druids": (3, 2, 194, 225)}


def main():
    miss = [states.mission(m) for m in sorted(states.MISSION_POS)]
    states.derive_save("kaarg_30", "kaarg_all", "Kaarg, estagio 30, TODOS os locais do mapa na lista (so para o mapa-mundi)", 30,
                       [TOWN_LOC["kaarg"], TOWN_LOC["druids"]] + miss, cur=0)
    states.derive_save("druids_60", "druids_all", "Acampamento druida, estagio 60, TODOS os locais do mapa na lista (so para o mapa-mundi)", 60,
                       [TOWN_LOC["druids"], TOWN_LOC["kaarg"]] + miss, cur=0)


if __name__ == "__main__":
    main()
