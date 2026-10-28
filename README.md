# Quiz & Quer

Eine lokale Quiz-Webapp für bis zu 20 Teilnehmergeräte. Ein Server steuert den gemeinsamen Spielzustand; SQLite speichert Quizvorlagen, Session-Kopien, Antworten, Punkte und Medienreferenzen. Die Oberfläche verwendet keine externen Fonts, CDNs oder Cloud-Dienste.

## Start mit Docker

Voraussetzung: Docker mit laufender Linux-Container-Engine, etwa Docker Desktop.

```sh
docker compose up -d --build
```

Dashboard: **http://localhost:3000**. Datenbank und Uploads liegen im benannten Volume `quizabend-data` (Compose ergänzt normalerweise den Projektnamen). Die leere Datenbank wird beim ersten Start automatisch initialisiert. Ein Image-Update oder `docker compose down` erhält die Daten.

Für den ersten Build werden Internetzugriff und das Node-Basisimage benötigt. Der fertige Container funktioniert vollständig offline. Er lässt sich mit `docker save`/`docker load` auf einen anderen Rechner übertragen; bestehende Quizdaten liegen separat im Volume.

### Gäste im WLAN

1. Handys, TV und Serverrechner mit demselben erreichbaren Heimnetz verbinden.
2. Dashboard am Server oder unter `http://<LAN-IP-des-Servers>:3000` öffnen.
3. Quiz erstellen, speichern und **Session erstellen** wählen.
4. In der Lobby unter **Adresse für Gäste** die LAN-Adresse des Serverrechners eintragen. `localhost` ist für andere Geräte nicht erreichbar; die im Container erkannten IPs können Docker-interne Adressen sein.
5. QR-Code scannen oder Einladungslink öffnen. Pro Spieler bzw. Team wird ein Name vergeben. Teams nutzen ein gemeinsames Handy.
6. **TV / Beamer öffnen** wählen und bei Audio einmal auf dem TV **Audio aktivieren** drücken. Der Moderator startet, pausiert und setzt Audio zentral zurück.
7. Sobald alle da sind, das Quiz starten. Neue Teilnehmer können danach nicht mehr beitreten.

Alternativ die feste Gastadresse in einer `.env` neben `compose.yaml` setzen:

```dotenv
PUBLIC_URL=http://192.168.178.20:3000
```

Port 3000 muss im privaten Netzwerk erreichbar sein. Gast-WLAN mit Geräteisolation kann Verbindungen verhindern. Es gibt wie gewünscht **keine Anmeldung und keine Rollenzugriffssperre**: Alle im erreichbaren Netz können das Admin-Dashboard öffnen. Die App ist für ein vertrauenswürdiges Heimnetz konzipiert.

## Quiz vorbereiten

- Vorlagen erstellen, bearbeiten und duplizieren; Fragen über die Pfeile sortieren.
- Einzelspieler oder Teams und Grundpunkte pro Quiz wählen; Punkte je Frage optional überschreiben.
- Multiple Choice: zwei bis acht Antwortoptionen, eine oder mehrere richtige Antworten. Nur die exakt richtige Auswahl erhält Punkte.
- Offene Fragen: Texteingabe am Handy oder mündlich, Bewertung durch den Moderator.
- Bild-/Audiofragen: mündliche Antwort und manuelle Bewertung. Medien lassen sich auch anderen Fragetypen zuordnen.
- Uploads: PNG, JPG, GIF, WebP, MP3, WAV, OGG, M4A, maximal 20 MB pro Datei. Die tatsächliche Audiowiedergabe hängt von der Codec-Unterstützung des TV-Browsers ab; MP3/WAV sind eine gute Ausgangsbasis.
- Lösungstext wird erst bei der Auflösung angezeigt. Bilder und Audio erscheinen nur auf der TV-Ansicht und nach Freigabe des Moderators.

Eine Session enthält eine feste Kopie der Quizvorlage. Nachträgliche Vorlagenänderungen beeinflussen laufende oder archivierte Runden nicht. Beim Editorwechsel vor dem Speichern gehen ungespeicherte Änderungen verloren.

## Spielablauf

`Lobby → Antworten → Schließen → Bewerten → Auflösen → nächste Frage → Endergebnis`

- Kein Timer; der Moderator kontrolliert alle Übergänge.
- Multiple-Choice-Auswahl wird sofort gespeichert; Textantworten mit **Antwort speichern**. Antworten dürfen bis zum Schließen erneut gespeichert werden.
- Der Server prüft den Zustand und die aktuelle Fragenummer bei jeder Antwort. Verspätete Eingaben, auch nach Netzunterbrechung, werden abgewiesen.
- Multiple Choice wird beim Schließen automatisch bewertet. Andere Typen benötigen für jeden Teilnehmer eine Bewertung, auch wenn diese 0 Punkte beträgt.
- Teilpunkte sind möglich. Punkte liegen zwischen 0 und dem jeweiligen Fragenmaximum. Keine Minus- oder Bonuspunkte.
- Erst nach vollständiger Bewertung wird die Auflösung freigegeben. Rangliste optional ein-/ausblenden.
- Unter **Antworten & Punkte je Frage · Korrekturen** lassen sich bereits vergebene Punkte bis zum Quizende anpassen. Antworten bleiben gesperrt; Fragen können nicht erneut geöffnet werden.
- Das endgültige Beenden nach der letzten Auflösung sperrt sämtliche Änderungen. Endrangliste und kompletter Verlauf bleiben im Admin-Archiv.
- Gleichstände erhalten denselben Rang; Namen werden innerhalb eines Gleichstands alphabetisch sortiert.

## Verbindung und Wiederherstellung

Die Ansichten fragen den Server alle 800 ms ab und aktualisieren sich bei geändertem Zustand. Bei Verbindungsabbrüchen wird automatisch erneut verbunden. Jede bestätigte Änderung wird synchron in SQLite gespeichert (WAL, `synchronous=FULL`). Nach einem Neustart steht die Runde am gespeicherten Punkt bereit.

Gäste werden durch einen zufälligen Token im lokalen Browserspeicher wiedererkannt. Für die Rückkehr denselben Browser und dieselbe Serveradresse verwenden. Gelöschte Browserdaten, privater Modus oder ein Gerätewechsel ermöglichen keine automatische Wiedererkennung. Ein Name allein ist kein Wiederbeitrittsnachweis.

Audio wird anhand der zuletzt gespeicherten Wiedergabeposition und des Startzeitpunkts synchronisiert. Nach Neustart oder TV-Neuladen ggf. Audio erneut aktivieren und über **Von vorne** neu starten. Der Browser kann automatisches Abspielen bis zu einer Benutzerinteraktion blockieren.

## Lokale Entwicklung ohne Docker

Node.js ab 24.13:

```sh
npm ci
npm start
```

Standardmäßig liegt die Datenbank in `data/quiz.sqlite`, Uploads in `data/uploads/`. Einstellungen: `PORT` (3000), `DATA_DIR`, `PUBLIC_URL`. Node meldet derzeit für sein eingebautes SQLite-Modul einen Experimental-Hinweis.

```sh
npm run check
npm test
```

Tests nutzen temporäre Datenbanken und einen lokalen HTTP-Server. Sie prüfen Zustandsübergänge, verspätete Antworten, Teilpunkte, endgültige Sperre, Session-Kopien, Wiederherstellung, Teilnehmerlimit, reduzierte Gästeansichten, QR-Codes, Uploads und HTTP-Bytebereiche.

## Sicherung und Aktualisierung

Vor einer Dateisicherung den Container stoppen und das **gesamte Volume** einschließlich `quiz.sqlite`, eventueller WAL/SHM-Dateien und `uploads/` sichern. Für die Wiederherstellung diese Daten in das Volume einer gestoppten Instanz zurückspielen und danach starten. `docker compose down -v` löscht ausdrücklich auch die gespeicherten Daten und sollte für gewöhnliche Updates nicht verwendet werden.

## Aufbau

- `server.js`: HTTP-API, lokale Dateien, QR-Codes, Uploads und Audiobereiche.
- `lib/game.js`: validierte Zustandsmaschine und persistente Datenhaltung.
- `public/`: responsive Admin-, Moderator-, Gäste- und TV-Oberfläche.
- `test/game.test.js`: automatisierte Fachlogik- und HTTP-Tests.
- `Dockerfile`, `compose.yaml`: Container mit persistentem Datenvolume.

Nicht enthalten: Quizimport/-export, zentraler Fragenpool, Konten, Buzzer, Timer und Internet-Hosting.

## Kategorien, Spielmodi und neue Fragetypen

Jede Frage hat eine **Themenkategorie** (zum Beispiel Sport) und unabhängig davon eine **Antwortart**: am Handy oder mündlich. Die früheren Typen „offen mit Text“ und „offen mündlich“ sind im Editor zu „Offene Frage“ mit separater Antwortart zusammengeführt. Vorhandene Vorlagen bleiben lesbar und werden erst beim Speichern normalisiert.

In der Session-Lobby wählen:

- **Mit Antwortabgabe:** Die Antwortart der jeweiligen Frage gilt.
- **Ohne Antwortabgabe:** Alle treten weiterhin per Handy bei. Die Handys zeigen Frage und freigegebenen Spielstand, aber keine Antwortfelder. Jede Bewertung erfolgt manuell, auch bei Multiple Choice.
- **Reihenfolge der Vorlage** oder **nach Kategorien gruppiert**. Kategorien erscheinen in der Reihenfolge ihres ersten Auftretens; innerhalb der Kategorie bleibt die Vorlagenreihenfolge erhalten.

Neue Sessions zeigen vor der ersten Frage und nach jeder Auflösung ein **Kategorienbrett** mit Kategorien, Gesamtzahl und verbleibenden Fragen. Es verrät keine Fragetexte. Der Moderator wechselt mit „Kategorien anzeigen“ zum Brett und mit „Nächste Frage öffnen“ weiter. Auch nach der letzten Auflösung folgt das Brett, bevor das Quiz endgültig beendet wird. Bestehende Sessions behalten ihren vorherigen Ablauf.

Zusätzliche Fragetypen:

- **Wahr / Falsch:** Eine der beiden Antworten ist richtig.
- **Schätzfrage:** Numerischer Zielwert, Einheit und absolute Toleranz. Innerhalb einschließlich der Toleranz gibt es volle Punkte, sonst 0.
- **Reihenfolge:** 2–8 Einträge in korrekter Reihenfolge vorbereiten. Die Session mischt die Anzeige; Gäste ordnen die Positionen per Auswahlfeldern zu.
- **Zuordnung:** 2–8 Paare als `Begriff | Zuordnung`, eines pro Zeile. Die rechten Begriffe werden gemischt und von Gästen zugeordnet.
- **Hinweisfrage:** 1–10 Hinweise, einer pro Zeile. Der Moderator deckt sie während der Antwortphase einzeln auf; die Bewertung erfolgt manuell.

Wahr/Falsch, Schätzung, Reihenfolge und Zuordnung werden bei digitaler Antwortabgabe automatisch bewertet. Reihenfolge und Zuordnung erfordern die vollständig richtige Lösung. Mündliche Antworten und der Modus ohne Antwortabgabe werden immer manuell bewertet. Für jede Bewertung stehen Schnellbuttons für **0, halbe und volle Punkte** zur Verfügung; individuelle Punkte bleiben möglich.

## Logo und Beamer-Übergänge

`public/logo.svg` enthält das Logo, `public/icon.svg` das skalierbare App-Icon und Favicon. Die Farbpalette bleibt dunkel mit Limettengrün.

Die TV-Ansicht animiert Wechsel zwischen Kategorien, Frage, Bewertung, Auflösung und Rangliste mit kurzen Einblendungen. Kategorie-Kacheln erscheinen leicht versetzt. Normale Antwort-Updates lösen keine erneute Übergangsanimation aus. Die Betriebssystem-Einstellung für reduzierte Bewegung wird berücksichtigt.

## Löschen und Spielfiguren

Im Dashboard haben Quizvorlagen und Sessions jeweils eine Schaltfläche **Löschen**. Vor dem endgültigen Löschen erscheint ein Bestätigungsdialog mit dem betroffenen Namen. Abbrechen verändert keine Daten. Eine gelöschte Quizvorlage entfernt keine bereits angelegten Sessions; diese behalten ihre eigene Kopie. Beim Löschen einer Session verschwinden deren Teilnehmer, Antworten und Punkte. Verbundene Geräte zeigen anschließend, dass die Session nicht mehr verfügbar ist. Gemeinsam verwendete Upload-Dateien werden nicht automatisch gelöscht.

Beim Beitritt wählt jeder Spieler beziehungsweise jedes Team eine von zehn einfachen Spielfiguren als Avatar. Die Symbole erscheinen in der Lobby, Moderation, Gästeansicht und Rangliste. Mehrere Teilnehmer dürfen denselben Avatar verwenden; der Name bleibt zur Unterscheidung sichtbar. Bestehende Teilnehmer ohne Avatar erhalten die neutrale Spielfigur. Die Symbole funktionieren offline und werden je nach Betriebssystem als dessen Emoji-/Symbolgrafiken dargestellt.
