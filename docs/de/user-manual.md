# 2syn Benutzerhandbuch

Willkommen bei **2syn**! 2syn ist ein leistungsstarkes, sicheres Remote-Desktop-System, das WebRTC Ende-zu-Ende-Verschlüsselung mit adaptiver Bitraten-Technologie kombiniert und plattformübergreifende Verbindungen von macOS/Windows-Hosts zu iOS/macOS-Clients unterstützt.

---

## 1. Verbindungsherstellung

### 1.1 Host-ID abrufen
Starten Sie 2syn auf dem **Host** (dem zu steuernden Computer):
- Im Feld「My ID」oben auf dem Bildschirm wird eine 9-stellige ID angezeigt (z.B. `569-639-684`).
- Klicken Sie auf die 📋-Schaltfläche neben der ID, um sie zu kopieren, oder auf die ⬛-Schaltfläche, um einen QR-Code anzuzeigen.

### 1.2 Von einem iOS-Gerät verbinden
1. Starten Sie die 2syn-App auf iOS.
2. Geben Sie die Host-ID manuell in das Feld「Connect to」ein, oder lassen Sie den Host den QR-Code anzeigen und scannen Sie ihn mit der nativen iOS-Kamera — die ID wird automatisch eingetragen.
3. Tippen Sie auf「Connect」. Das System führt automatisch NAT-Traversal über STUN durch und stellt eine direkte Ende-zu-Ende-Verbindung her — keine Port-Weiterleitung am Router erforderlich.

---

## 2. Fernsteuerung

### 2.1 Steuerungsmodus wechseln
Tippen Sie nach der Verbindung auf die ⚙️-Symbolleisten-Schaltfläche oben rechts, um das Panel aufzuklappen und zwischen zwei Steuerungsmodi zu wechseln:

| Modus | Beschreibung |
|---|---|
| **Trackpad（Trackpad-Modus）** | Finger ziehen = Cursor bewegen；Einzel-Tap = Linksklick；Zwei-Finger-Wischen auf/ab = Scrollen；Zwei-Finger-Tap = Rechtsklick |
| **Direct Touch（Direktberührungs-Modus）** | Berührungskoordinaten entsprechen direkt den Bildschirmkoordinaten des Hosts |

### 2.2 Zwei-Finger-Scrollen
Im Trackpad-Modus wischen Sie mit zwei Fingern auf dem Bildschirm nach oben oder unten, um Scroll-Ereignisse an den Host zu senden. Funktioniert mit allen Anwendungen.

### 2.3 Tastatureingabe
1. Tippen Sie auf das Tastatur-Symbol in der Symbolleiste, um die iOS-Bildschirmtastatur aufzurufen.
2. Über der Tastatur erscheint eine Modifikatortasten-Symbolleiste (Esc, Tab, ⌃, ⌥, ⌘, ⇧, Pfeiltasten) zum Senden von Tastaturkürzeln.
3. Einmal auf eine Modifikatortaste tippen sperrt sie (leuchtet blau auf); sie wird nach einem Tastendruck automatisch entsperrt. Erneutes Tippen entsperrt manuell.

### 2.4 Apple Pencil Druckempfindlichkeit
Auf einem iPad mit Apple Pencil-Unterstützung schreiben Sie direkt auf dem Bildschirm mit dem Pencil. 2syn überträgt:
- Druckwert (0–100%)
- Neigungswinkel (X/Y-Achse ±90°)

in Echtzeit an den Host. Professionelle Apps wie Procreate und Adobe Photoshop erhalten vollständige Druck- und Neigungsdaten.

---

## 3. Audio-Streaming

Das System-Audio des Hosts (einschließlich App-Töne, Musik usw.) wird automatisch auf Ihr iOS-Gerät gestreamt.

- **Kein Ton auf iOS**: Tippen Sie auf die Schaltfläche「🔇 Tippen zum Aktivieren des Tons」oben rechts (die Sicherheitsrichtlinie des iOS-Browsers erfordert eine Benutzergeste vor der Audiowiedergabe).
- Nach dem Verbinden tippen Sie auf「🔊 Mute」zum Umschalten der Stummschaltung.

---

## 4. Zwischenablage-Synchronisation

- **Host → iOS**: Nach dem Kopieren von Text auf dem Host erscheint eine Toast-Benachrichtigung am unteren Rand des iOS-Bildschirms mit einer Vorschau des kopierten Inhalts. Tippen Sie auf den Toast, um den Text in die lokale iOS-Zwischenablage zu schreiben.
- **iOS → Host**: Geben Sie Text auf der iOS-Tastatur ein, dann lang drücken zum Einfügen — die Eingabe wird direkt an das fokussierte Feld auf dem Host gesendet.

---

## 5. Anzeiggröße

Die Schaltfläche「🔍 Originalgröße / Bildschirm anpassen」in der Symbolleiste wechselt zwischen zwei Anzeigemodi:

| Modus | Beschreibung |
|---|---|
| **Bildschirm anpassen** | Host-Bildschirm wird skaliert, um den gesamten iOS-Display auszufüllen |
| **Originalgröße** | 1:1-Pixelanzeige mit Schwenk-Unterstützung, ideal für präzise Arbeit |

---

## 6. Adaptiver Bitrate（ABR）

2syn verfügt über eine integrierte automatische Qualitätsanpassung, die alle 500 ms Netzwerk-RTT und Paketverlust erkennt:

| Netzwerkzustand | Automatische Anpassung |
|---|---|
| Gut（RTT < 80 ms, Verlust < 1%）| Hohe Qualität, hohe Bildrate |
| Mittel | Mittlere Qualität |
| Schlecht（RTT > 200 ms oder Verlust > 5%）| Reduzierte Bildrate und Bitrate zur Aufrechterhaltung der Verbindungsstabilität |

Der Punktindikator oben rechts (grün / gelb / rot) spiegelt die Verbindungsqualität in Echtzeit wider.

---

## 7. Datenschutz-Schwarzbildmodus

Aktivieren Sie「Datenschutzmodus」in der 2syn-Oberfläche auf dem **Host**, um den Host-Bildschirm zu verdunkeln und zu verhindern, dass Außenstehende Ihre Vorgänge sehen. Die Fernsteuerung funktioniert weiterhin normal.

---

## 8. Dateiübertragung

Bei stabiler Verbindung (P2P-Direktverbindung) ziehen Sie Dateien in das 2syn-Fenster von der iOS-Seite oder dem Host, um eine Übertragung auszulösen. Alle Übertragungen sind Ende-zu-Ende-verschlüsselt über den WebRTC Data Channel.

---

## 9. Trennen und Wiederverbinden

Tippen Sie in der Symbolleiste auf ⚙️ → 「🚪 Abmelden」, um die Sitzung zu beenden. Wenn die Verbindung unerwartet abbricht, zeigt die App eine Aufforderung — geben Sie die ID erneut ein, um wieder zu verbinden.

---

## 10. Häufig gestellte Fragen

**F: Die Verbindung hängt bei „Verbinden..." und kann nicht hergestellt werden?**
A: Wenn sich beide Seiten hinter strengen Unternehmens-Firewalls (Symmetric NAT) befinden, kann die NAT-Traversal fehlschlagen. Versuchen Sie, eine Seite auf ein 4G/5G-Mobilfunknetz umzustellen und es erneut zu versuchen.

**F: Kein Ton auf iOS?**
A: Tippen Sie auf die Schaltfläche「🔇 Tippen zum Aktivieren des Tons」auf dem Bildschirm. iOS benötigt eine Benutzergeste, um die Audiowiedergabe zu entsperren.

**F: Unscharfes oder ruckeliges Video?**
A: Adaptiver Bitrate (ABR) passt die Qualität automatisch basierend auf den Netzwerkbedingungen an. Die Qualität sinkt, um bei schlechtem Netz die Flüssigkeit aufrechtzuerhalten, und erholt sich automatisch, wenn sich das Netzwerk verbessert.

**F: Apple Pencil hat keinen Druckeffekt?**
A: Stellen Sie sicher, dass 2syn auf Ihrem iPad die neueste Version ist und dass 2syn auf dem Host auf v3.5.11 oder höher aktualisiert wurde.

**F: Nach dem Scannen des QR-Codes keine Verbindung möglich?**
A: Der QR-Code enthält nur die ID. Vergewissern Sie sich, dass 2syn auf dem Host läuft und dieselbe ID anzeigt.

---

*2syn v3.5.11 · Support: Kontaktieren Sie uns über App Store-Bewertungen oder offizielle Kanäle*
