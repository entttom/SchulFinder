# SchulFinder

Schulen in Österreich auf der Karte finden und in der Umgebung vergleichen. Mobil optimiert, statisch gebaut, ohne Backend.

- **Karte:** alle Schulen mit Suche (Ort, Postleitzahl, Schule), Filter und Standort
- **Vergleich:** Schulen im Umkreis als sortierbare Liste, bis zu sechs nebeneinander (teilbarer Link)
- **Detailseiten:** eine Seite pro Schule mit Kontakt, Kennzahlen und Übertritten

## Entwicklung

```bash
npm install
npm run data   # lädt und verknüpft die Quellen nach public/data/ (Übertritte beim ersten Mal ca. 8 Minuten)
npm run dev    # http://localhost:4321
npm test       # Tests der Zusammenführung
npm run build  # erzeugt dist/ (eine Seite pro Schule)
```

`npm run data -- --offline` führt die Daten nur aus `.cache/` neu zusammen, `-- --no-uebertritte` überspringt die Übertritte.

## Daten

Die Schulkennzahl (SKZ) ist der gemeinsame Schlüssel.

| Quelle | liefert | Hinweis |
|---|---|---|
| [Bildungskompass](https://www.bildungskompass.gv.at) | Name, Schulart, Erhalter, Kontakt, Bezirk, Chancenbonus, Schulmittelwerte der Volksschulen (iKMPLUS: Deutsch Lesen und Mathematik als oberes, mittleres oder unteres Drittel im Vergleich zu ähnlichen Schulen) | Die Website-API ist nicht als offene Schnittstelle dokumentiert. Der Abruf erfolgt einmal pro Lauf, gedrosselt und mit eigenem User-Agent. |
| [Statistik Austria, Schulatlas](https://www.statistik.at/atlas/schulen/) | Standort, Klassen, Schüler, Übertritte | Die Lizenz der Zusatzfelder ist nicht ausdrücklich geklärt. Die offenen Stammdaten stehen als [OGD unter CC BY 4.0](https://data.statistik.gv.at/web/meta.jsp?dataset=OGDEXT_SCHULSRV_1). |
| [basemap.at](https://basemap.at) | Grundkarte | |

Die erzeugten Daten (`public/data/`, `.cache/`) liegen nicht im Repository. Sie entstehen im Build. Jede Seite nennt die Quellen.
Einzelne Kennzahlen zeigen nur einen Ausschnitt. Die Seite zeigt sie neutral, ohne Ranking und ohne Sortierung nach den Schulmittelwerten.

## Deployment

GitHub Pages über `.github/workflows/deploy.yml` (bei Push auf `main`, monatlich und manuell).
In den Repository-Einstellungen unter Pages die Quelle "GitHub Actions" wählen.
Für eine eigene Domain `BASE` im Workflow auf `/` setzen.
