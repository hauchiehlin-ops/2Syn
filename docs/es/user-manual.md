# Manual de Usuario de 2syn

¡Bienvenido a **2syn**! 2syn es un sistema de escritorio remoto de alto rendimiento y seguro que combina cifrado de extremo a extremo WebRTC con tecnología de tasa de bits adaptativa, compatible con conexiones multiplataforma de hosts macOS/Windows a clientes iOS/macOS.

---

## 1. Emparejamiento de Conexión

### 1.1 Obtener el ID del Host
Inicie 2syn en el **host** (el ordenador que se va a controlar):
- Un ID de 9 dígitos aparecerá en el campo「My ID」en la parte superior de la pantalla (p. ej. `569-639-684`).
- Haga clic en el botón 📋 junto al ID para copiarlo, o en el botón ⬛ para mostrar un código QR.

### 1.2 Conectar desde un Dispositivo iOS
1. Inicie la aplicación 2syn en iOS.
2. Introduzca manualmente el ID del host en el campo「Connect to」, o pida al host que muestre el código QR y escanéelo con la cámara nativa de iOS — el ID se rellenará automáticamente.
3. Toque「Connect」. El sistema realiza automáticamente el NAT traversal a través de STUN y establece una conexión directa de extremo a extremo — no se requiere configuración de reenvío de puertos en el router.

---

## 2. Control Remoto

### 2.1 Cambio de Modo de Control
Tras conectar, toque el botón ⚙️ de la barra de herramientas en la esquina superior derecha para expandir el panel y cambiar entre dos modos de control:

| Modo | Descripción |
|---|---|
| **Trackpad（Modo Trackpad）** | Deslizar dedo = mover cursor；toque único = clic izquierdo；deslizamiento vertical con dos dedos = desplazamiento；toque con dos dedos = clic derecho |
| **Direct Touch（Modo Toque Directo）** | Las coordenadas del toque se corresponden directamente con las coordenadas de la pantalla del host |

### 2.2 Desplazamiento con Dos Dedos
En el modo Trackpad, deslice dos dedos hacia arriba o hacia abajo en la pantalla para enviar eventos de desplazamiento al host. Funciona con todas las aplicaciones.

### 2.3 Entrada de Teclado
1. Toque el icono del teclado en la barra de herramientas para invocar el teclado en pantalla de iOS.
2. Aparecerá una barra de teclas modificadoras (Esc, Tab, ⌃, ⌥, ⌘, ⇧, teclas de flecha) sobre el teclado para enviar combinaciones de teclas de acceso directo.
3. Toque una tecla modificadora una vez para bloquearla (se ilumina en azul); se desbloquea automáticamente tras una pulsación de tecla. Toque de nuevo para desbloquear manualmente.

### 2.4 Sensibilidad a la Presión del Apple Pencil
En un iPad con soporte para Apple Pencil, escriba directamente en la pantalla con el Pencil. 2syn transmite:
- Valor de presión (0–100%)
- Ángulo de inclinación (eje X/Y ±90°)

al host en tiempo real. Aplicaciones profesionales como Procreate y Adobe Photoshop recibirán datos completos de presión e inclinación.

---

## 3. Transmisión de Audio

El audio del sistema del host (incluyendo sonidos de aplicaciones, música, etc.) se transmite automáticamente a su dispositivo iOS.

- **Sin audio en iOS**: Toque el botón「🔇 Tocar para activar audio」en la esquina superior derecha (la política de seguridad del navegador iOS requiere un gesto del usuario antes de la reproducción de audio).
- Tras conectar, toque「🔊 Mute」para alternar el silencio.

---

## 4. Sincronización del Portapapeles

- **Host → iOS**: Después de copiar texto en el host, aparece una notificación Toast en la parte inferior de la pantalla iOS con una vista previa del contenido copiado. Toque el Toast para escribir el texto en el portapapeles local de iOS.
- **iOS → Host**: Escriba en el teclado de iOS, luego mantenga presionado para pegar — la entrada se envía directamente al campo enfocado en el host.

---

## 5. Tamaño de Visualización

El botón「🔍 Tamaño Original / Ajustar a Pantalla」en la barra de herramientas alterna entre dos modos de visualización:

| Modo | Descripción |
|---|---|
| **Ajustar a Pantalla** | La pantalla del host se escala para llenar toda la pantalla iOS |
| **Tamaño Original** | Visualización 1:1 de píxeles con soporte de panorámica, ideal para trabajo de precisión |

---

## 6. Tasa de Bits Adaptativa（ABR）

2syn tiene ajuste automático de calidad integrado, detectando RTT de red y pérdida de paquetes cada 500 ms:

| Condición de Red | Ajuste Automático |
|---|---|
| Buena（RTT < 80 ms, pérdida < 1%）| Alta calidad, alta tasa de fotogramas |
| Regular | Calidad media |
| Mala（RTT > 200 ms o pérdida > 5%）| Tasa de fotogramas y tasa de bits reducidas para mantener la estabilidad de la conexión |

El indicador de punto en la esquina superior derecha (verde / amarillo / rojo) refleja la calidad de la conexión en tiempo real.

---

## 7. Modo Pantalla Negra de Privacidad

Marque「Modo Privacidad」en la interfaz 2syn del **host** para oscurecer la pantalla del host, impidiendo que los espectadores vean sus operaciones. El control remoto continúa funcionando normalmente.

---

## 8. Transferencia de Archivos

Cuando la conexión es estable (conexión directa P2P), arrastre archivos a la ventana 2syn desde el lado iOS o el lado del host para iniciar una transferencia. Todas las transferencias están cifradas de extremo a extremo a través del WebRTC Data Channel.

---

## 9. Desconexión y Reconexión

Toque ⚙️ → 「🚪 Cerrar sesión」en la barra de herramientas para finalizar la sesión. Si la conexión se interrumpe inesperadamente, la aplicación mostrará un aviso — vuelva a introducir el ID para reconectar.

---

## 10. Preguntas Frecuentes

**P: ¿La conexión se queda atascada en "Conectando..." y no se puede establecer?**
R: Si ambas partes están detrás de cortafuegos corporativos estrictos (Symmetric NAT), puede fallar el NAT traversal. Intente cambiar uno de los lados a una red móvil 4G/5G y vuelva a intentarlo.

**P: ¿Sin audio en iOS?**
R: Toque el botón「🔇 Tocar para activar audio」en la pantalla. iOS requiere un gesto del usuario para desbloquear la reproducción de audio.

**P: ¿Vídeo borroso o con retraso?**
R: La Tasa de Bits Adaptativa (ABR) ajusta automáticamente la calidad según las condiciones de red. La calidad disminuye para mantener la fluidez en redes deficientes y se recupera automáticamente cuando la red mejora.

**P: ¿Apple Pencil no tiene efecto de presión?**
R: Asegúrese de que 2syn en su iPad es la última versión y que 2syn en el host se ha actualizado a v3.5.11 o posterior.

**P: ¿No se puede conectar después de escanear el código QR?**
R: El código QR solo contiene el ID. Confirme que 2syn en el host está en ejecución y mostrando el mismo ID.

---

*2syn v3.5.11 · Soporte: contáctenos a través de las reseñas de la App Store o los canales oficiales*
