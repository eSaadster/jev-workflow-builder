# Drayage fleet list — recipe verdict vs Jev tier

Generated: 2026-09-21T21:27:46.389Z
Census filter: NJ+NY, crgo_intermodal='X', status active, 3-20 drivers, authorized-for-hire, non-passenger, non-private.
Scanned 1000 census rows; 30 passed. Safety band [50,74] with the recipe's alert override was NOT used to pre-filter, so band-dropped carriers still reached Jev.
Rank population: 186130 carriers with >= 5 inspections (PortPro population rank, not an FMCSA percentile).

## Cross-tab

| recipe:drop / jev:review | recipe:kept / jev:review | recipe:drop / jev:qualified | recipe:kept / jev:qualified |
|---|---|---|---|
| 17 | 8 | 3 | 2 |

## Carriers

| DOT | Name | City | Drv | PU | maxRank | alerts | recipe | Jev tier | op (p) | port (p) | size (p) | risk (p) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 15059 | ROGERS SERVICE GROUP INC | BINGHAMTON, NY | 15 | 30 | 8 | – | drop | **review** | drayage_intermodal (0.85) | no (0.07) | no (0.48) | no (0.16) |
| 24111 | NASSAU PRINTING MACHINERY INC | COPIAGUE, NY | 12 | 11 | 73 | – | keep | **review** | drayage_intermodal (0.87) | no (0.65) | yes (0.88) | yes (0.68) |
| 43234 | LESTER FELLOWS CO INC | BURLINGTON, NJ | 5 | 5 | 81 | – | drop | **qualified** | drayage_intermodal (0.97) | yes (0.77) | yes (0.84) | yes (0.64) |
| 49848 | JERSEY CITY TRANSFER INC | CINNAMINSON, NJ | 12 | 12 | 91 | – | drop | **review** | drayage_intermodal (0.98) | no (0.54) | yes (0.88) | yes (0.61) |
| 58172 | GLENERY INC | KEARNY, NJ | 6 | 6 | – | – | drop | **review** | drayage_intermodal (0.97) | yes (0.97) | yes (0.85) | no (0.23) |
| 129916 | W J CASEY TRUCKING & RIGGING CO INC | BRANCHBURG, NJ | 12 | 13 | – | – | drop | **review** | drayage_intermodal (0.69) | yes (0.84) | yes (0.84) | no (0.22) |
| 138970 | SEA TRANSFER CORPORATION | SECAUCUS, NJ | 7 | 8 | 82 | – | drop | **qualified** | drayage_intermodal (1.00) | yes (0.96) | yes (0.85) | yes (0.64) |
| 142382 | COPEBESTWAY EXPRESS INC | CHEEKTOWAGA, NY | 17 | 19 | 48 | – | drop | **review** | drayage_intermodal (0.91) | no (0.38) | yes (0.82) | yes (0.67) |
| 153358 | J SUPOR & SON TRUCKING & RIGGING CO INC | HARRISON, NJ | 10 | 8 | 64 | – | keep | **qualified** | drayage_intermodal (0.88) | yes (0.97) | yes (0.86) | yes (0.69) |
| 163354 | R ROMAN TRUCK LEASING INC | ELIZABETH, NJ | 14 | 14 | – | – | drop | **review** | drayage_intermodal (0.90) | yes (0.98) | yes (0.86) | no (0.21) |
| 182895 | DYNAMIC DELIVERY SERVICES INC | NORTH BERGEN, NJ | 15 | 28 | 75 | – | drop | **review** | drayage_intermodal (0.88) | yes (0.96) | no (0.41) | yes (0.79) |
| 215372 | L & A FORWARDING INC | UNION, NJ | 16 | 16 | 73 | – | keep | **qualified** | drayage_intermodal (0.87) | yes (0.96) | yes (0.85) | yes (0.71) |
| 259173 | JAN PACKAGING INC | DOVER, NJ | 5 | 11 | 90 | – | drop | **qualified** | drayage_intermodal (0.77) | yes (0.79) | yes (0.79) | yes (0.68) |
| 264533 | DE SANDRE BROS CO INC | CRANBURY, NJ | 5 | 4 | – | – | drop | **review** | drayage_intermodal (0.96) | yes (0.74) | yes (0.81) | no (0.17) |
| 268775 | KM TRANSPORTATION CO INC | LOGAN TOWNSHIP, NJ | 17 | 30 | 56 | – | keep | **review** | drayage_intermodal (0.79) | yes (0.82) | no (0.40) | yes (0.71) |
| 268777 | ECONOMY TRANSPORT CORPORATION | ROCHESTER, NY | 6 | 9 | 74 | – | keep | **review** | drayage_intermodal (0.89) | no (0.30) | yes (0.82) | yes (0.71) |
| 273591 | RUSINIAK'S SERVICE INC | CHEEKTOWAGA, NY | 18 | 17 | 61 | – | keep | **review** | drayage_intermodal (0.93) | no (0.36) | yes (0.83) | no (0.55) |
| 279495 | VITALE HEAVY HAULING INC | AUBURN, NY | 4 | 7 | 70 | – | keep | **review** | drayage_intermodal (0.56) | no (0.11) | yes (0.76) | yes (0.74) |
| 281291 | A M EXPRESS FREIGHT INC | EAST RUTHERFORD, NJ | 4 | 5 | – | – | drop | **review** | drayage_intermodal (0.96) | yes (0.96) | yes (0.81) | no (0.19) |
| 282082 | HILLSIDE WAREHOUSE AND TRUCKING CO INC | EDISON, NJ | 19 | 19 | – | – | drop | **review** | drayage_intermodal (0.86) | yes (0.93) | yes (0.84) | no (0.22) |
| 298012 | JUNELL CORP | WATERLOO, NY | 4 | 9 | – | – | drop | **review** | drayage_intermodal (0.85) | no (0.06) | yes (0.77) | no (0.25) |
| 308806 | CARGO LOGISTICS BY J CIOFFI INC | NEWARK, NJ | 5 | 5 | – | – | drop | **review** | drayage_intermodal (0.97) | yes (0.98) | yes (0.86) | no (0.25) |
| 309353 | A & D EXPRESS INC | MONMOUTH JUNCTION, NJ | 11 | 11 | – | – | drop | **review** | drayage_intermodal (0.95) | yes (0.72) | yes (0.85) | no (0.20) |
| 322418 | WILLIAM CRIST | CORINTH, NY | 3 | 3 | – | – | drop | **review** | drayage_intermodal (0.87) | no (0.11) | yes (0.78) | no (0.22) |
| 327521 | JAMES O'DONOGHUE | STAFFORD, NY | 15 | 16 | 64 | – | keep | **review** | drayage_intermodal (0.89) | no (0.36) | yes (0.86) | yes (0.76) |
| 350010 | TREZZCO TRUCKING INC | CRANFORD, NJ | 6 | 6 | – | – | drop | **review** | drayage_intermodal (0.92) | yes (0.93) | yes (0.83) | no (0.23) |
| 378608 | CIOFFI TOWING SERVICE INC | CHERRY HILL, NJ | 15 | 17 | 71 | – | keep | **review** | drayage_intermodal (0.93) | no (0.67) | yes (0.83) | yes (0.80) |
| 378839 | BORWEGEN TRUCKING INC | GREENVILLE, NY | 5 | 5 | 72 | – | keep | **review** | drayage_intermodal (0.89) | no (0.25) | yes (0.82) | yes (0.78) |
| 388343 | MIKE VAN ELSWYK TRUCKING INCORPORATED | ELIZABETH, NJ | 12 | 12 | 88 | – | drop | **review** | drayage_intermodal (0.95) | yes (0.98) | yes (0.89) | no (0.47) |
| 395849 | D BAS TRUCKING & WAREHOUSING LLC | ANDOVER, NJ | 4 | 4 | – | – | drop | **review** | drayage_intermodal (0.83) | no (0.64) | yes (0.80) | no (0.26) |
