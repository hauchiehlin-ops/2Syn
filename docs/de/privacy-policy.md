# 2syn Datenschutzerklärung

**Zuletzt aktualisiert:** 26. Juni 2026

Willkommen bei **2syn** (nachfolgend „die Software" oder „wir"). Diese Datenschutzerklärung erläutert, wie die Software Ihre Daten erfasst, verwendet und schützt.

**Grundlegendes Versprechen: Wir erfassen, speichern oder analysieren keine Bildschirmdaten des Remote-Desktops, Audiodaten oder Eingabedaten.**

---

## Eins. Daten, die wir erfassen, und deren Zweck

Um grundlegende Verbindungsdienste bereitzustellen, erfassen wir nur die folgenden Mindestinformationen:

### 1. Signalisierungsaustauschdaten（SDP／ICE Candidates）
- **Zweck**: Um Ihren beiden Geräten (Host und Client) zu helfen, Firewalls zu überwinden und eine WebRTC-Ende-zu-Ende-Verbindung (P2P) herzustellen.
- **Handhabung**: Diese vorübergehenden Netzwerk-Handshake-Daten (einschließlich lokaler oder öffentlicher IPs) werden sofort nach der Verbindungsherstellung vernichtet. **Der Signalisierungsserver der Software protokolliert oder speichert niemals dauerhaft Netzwerk-Handshake-Pakete.**

### 2. App-Einstellungen
- **Zweck**: Zum Speichern Ihrer Spracheinstellungen, des Anzeigemodus und anderer Einstellungen zur automatischen Anwendung beim nächsten Start.
- **Handhabung**: Wird nur lokal auf Ihrem Gerät gespeichert (iOS UserDefaults) und niemals an einen Server gesendet.

---

## Zwei. Daten, die wir NICHT erfassen

Basierend auf der dezentralisierten E2EE-Architektur von 2syn garantieren wir streng:

1. **Remote-Bildschirm, Video und Audio**: Alle Streams werden direkt Ende-zu-Ende zwischen Ihren beiden Geräten übertragen. Keine dritte Partei, einschließlich uns, kann sie abfangen oder entschlüsseln.
2. **Tastatur-, Maus- und Touch-Eingabe**: Alle Eingabebefehle werden lokal über P2P übertragen und passieren keinen Server.
3. **Apple Pencil Druck- und Neigungsdaten**: Stylus-Druckdaten werden direkt zwischen Geräten übertragen und auf keinem Server gespeichert.
4. **Personenbezogene Daten (PII)**: Die Software erfordert nicht die Angabe Ihres Namens, Ihrer E-Mail-Adresse oder Telefonnummer.
5. **Standortdaten**: Die Software greift nicht auf GPS oder genauen Standort zu.
6. **Kamera oder Mikrofon**: Der iOS-Client greift nicht auf die Kamera oder das Mikrofon zu.

---

## Drei. Datenweitergabe und Offenlegung an Dritte

Wir **verkaufen, tauschen oder vermieten** niemals Ihre Informationen an Dritte.

Die einzige Ausnahme: Wenn wir gesetzlich dazu verpflichtet werden (z.B. durch eine Gerichtsanordnung), können wir rechtmäßig die minimalen Verbindungsprotokolle (Verbindungszeitstempel) auf dem Signalisierungsserver bereitstellen. Technisch ist es uns jedoch unmöglich, Ihren Remote-Bildschirm oder übertragene Inhalte bereitzustellen.

---

## Vier. Verwendung von STUN-Servern

Die Software verwendet öffentliche STUN-Server (z.B. von Google bereitgestellt), um Geräten bei der Ermittlung ihrer öffentlichen IP-Adressen für die NAT-Traversal zu helfen. Diese Server bieten nur IP-Auflösung und können nicht auf Ihre Verbindungsinhalte zugreifen. Deren Datenschutzrichtlinien unterliegen den jeweiligen Anbietern.

Die Software verwendet eine STUN-only-Architektur und **verwendet standardmäßig keine TURN-Relay-Server**. Alle Verbindungen sind direkt.

---

## Fünf. Datensicherheit

- Die Ende-zu-Ende-Kommunikation verwendet die in WebRTC integrierten Verschlüsselungsprotokolle DTLS 1.3 / SRTP.
- App-Einstellungen werden in der iOS-System-Sandbox gespeichert und durch die native iOS-Sicherheit geschützt.

---

## Sechs. Datenschutz für Kinder

Die Software ist für Benutzer ab 13 Jahren konzipiert. Wir erfassen wissentlich keine persönlichen Daten von Kindern unter 13 Jahren.

---

## Sieben. Änderungen dieser Richtlinie

Bei wesentlichen Änderungen dieser Richtlinie werden wir eine Ankündigung in der Software oder auf unserer offiziellen Website veröffentlichen. Die weitere Nutzung der Software bedeutet Ihre Zustimmung zur aktualisierten Richtlinie.

---

## Acht. Kontakt

Wenn Sie Fragen zu dieser Datenschutzerklärung haben, kontaktieren Sie uns bitte über die App Store-Bewertungsseite oder unsere offiziellen Kundensupport-Kanäle.
