"""The Portuguese fuel models (Fernandes et al. 2009), the ones ICNF uses with Farsite, for ELMFIRE: their
parameters as rows of ELMFIRE's fuel model table, and the COS 2015 classes of fuel.json mapped to them.

Fernandes, P., Gonçalves, H., Loureiro, C., Fernandes, M., Costa, T., Cruz, M.G., Botelho, H. (2009). Modelos de
combustível florestal para Portugal. Actas do 6.º Congresso Florestal Nacional, SPCF, 348-354. Parameters as
tabulated in Paixão, L. (2017), Simulação de comportamento de fogo..., MSc thesis, NOVA Lisboa, Tabela 4.

The SGIF record of each fire gives the Farsite model at its ignition (MODFARSITE): 227 = M-PIN in Vieira do Minho,
223 = M-EUC in the Garfe fire of 7 Aug 2016. The codes 211-237 are free in ELMFIRE's table (it takes 1-303).
"""

import numpy as np

LB_FT2_PER_T_HA = 0.0204816
FT_PER_CM = 1 / 30.48
BTU_LB_PER_KJ_KG = 0.429923

# code: name, loads t/ha (1 h, 10 h, 100 h, live herb, live woody), SAV 1/cm (1 h, herb, woody), depth cm, Mx %, heat kJ/kg
MODELS = {
    211: ("F-EUC", (4.64, 2.96, 1.28, 0.00, 1.12), (41, 41, 49), 32.00, 26, 20969),
    212: ("F-FOL", (2.67, 1.28, 0.69, 0.00, 1.17), (45, 54, 49), 14.94, 25, 20469),
    213: ("F-PIN", (6.50, 1.50, 0.00, 0.00, 0.00), (54, 54, 54), 10.06, 45, 20469),
    214: ("F-RAC", (3.74, 2.00, 1.01, 0.00, 1.19), (64, 49, 45), 4.88, 28, 20469),
    221: ("M-CAD", (4.55, 1.86, 0.61, 0.00, 9.08), (60, 49, 49), 63.09, 29, 19970),
    222: ("M-ESC", (5.65, 1.50, 0.47, 0.00, 7.89), (49, 49, 54), 49.99, 27, 20469),
    223: ("M-EUC", (8.36, 3.81, 0.00, 0.00, 4.51), (47, 41, 49), 64.01, 32, 20969),
    224: ("M-EUCd", (1.37, 2.89, 1.59, 0.00, 1.84), (45, 41, 49), 39.93, 26, 20969),
    225: ("M-F", (4.51, 1.50, 0.49, 2.35, 0.47), (60, 79, 45), 29.87, 34, 19471),
    226: ("M-H", (2.71, 1.01, 0.00, 0.65, 0.09), (54, 79, 45), 10.06, 29, 20469),
    227: ("M-PIN", (7.22, 3.00, 0.00, 0.00, 6.88), (54, 54, 60), 49.99, 40, 20469),
    231: ("V-Ha", (0.49, 0.09, 0.00, 2.51, 0.29), (39, 60, 39), 60.05, 23, 18972),
    232: ("V-Hb", (0.29, 0.00, 0.00, 1.21, 0.00), (60, 60, 60), 35.05, 23, 18972),
    233: ("V-MAa", (9.50, 2.51, 0.00, 0.00, 14.50), (35, 39, 39), 104.85, 34, 20969),
    234: ("V-MAb", (6.01, 0.49, 0.00, 0.00, 7.51), (45, 45, 45), 49.99, 34, 20969),
    235: ("V-MH", (1.01, 1.01, 0.00, 1.50, 5.49), (45, 85, 39), 54.86, 25, 19471),
    236: ("V-MMa", (6.01, 3.99, 0.00, 0.00, 13.00), (24, 29, 29), 170.08, 23, 20469),
    237: ("V-MMb", (3.99, 0.49, 0.00, 0.00, 6.99), (29, 29, 29), 89.92, 20, 20469),
}
CODE = {v[0]: k for k, v in MODELS.items()}
SHRUBS = [n for n in CODE if n.startswith("V-M")]

# COS 2015 class -> Portuguese model. Classes not listed (farmland, built-up, water, ...) keep fuel.json's Scott &
# Burgan code. "shrub" is the --shrub option: V-MAa (tall shrub, much dead fuel: the gorse and heath of the Minho hills)
# by default.
COS = {"5.1.1.1": "M-ESC", "5.1.1.2": "M-ESC", "5.1.1.3": "M-CAD", "5.1.1.4": "M-CAD", "5.1.1.5": "M-EUC",
       "5.1.1.6": "M-ESC", "5.1.1.7": "M-CAD", "5.1.2.1": "M-PIN", "5.1.2.2": "M-PIN", "5.1.2.3": "F-RAC",
       "6.1.1.1": "shrub", "7.1.3.1": "V-MH", "3.1.1.1": "V-Hb"}


def codes(legend: list, shrub: str = "V-MAa") -> np.ndarray:
    """The fuel code of each legend entry of fuel.json: a Portuguese model where COS maps to one, else Scott & Burgan."""
    return np.array([CODE[shrub if COS.get(l["cos"]) == "shrub" else COS[l["cos"]]] if l["cos"] in COS
                     else l["scottBurgan"] for l in legend], np.int16)


def elmfire_rows() -> list[list]:
    """The models as rows of ELMFIRE's fuel model table (lb/ft2, 1/ft, ft, %, BTU/lb), for the request's fuel_models
    (engines/elmfire/adapter.py). Models with a live herbaceous load are dynamic (the herbs cure into dead fuel with
    their moisture), as in Scott & Burgan; one heat content (the dead one) for both."""
    rows = []
    for code, (name, w, sav, depth, mx, heat) in MODELS.items():
        rows.append([code, name, w[3] > 0, *[x * LB_FT2_PER_T_HA for x in w], *[s * 30.48 for s in sav],
                     depth * FT_PER_CM, mx, heat * BTU_LB_PER_KJ_KG])
    return rows
