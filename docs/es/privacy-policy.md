# Política de Privacidad de 2syn

**Última actualización:** 26 de junio de 2026

Bienvenido a **2syn** (en adelante, "el Software" o "nosotros"). Esta Política de Privacidad explica cómo el Software recopila, utiliza y protege sus datos.

**Compromiso fundamental: No interceptamos, almacenamos ni analizamos ninguna pantalla de escritorio remoto, audio ni datos de entrada.**

---

## Uno. Datos que Recopilamos y su Finalidad

Para proporcionar servicios de conectividad básicos, solo recopilamos la siguiente información mínima necesaria:

### 1. Datos de Intercambio de Señalización（SDP／ICE Candidates）
- **Finalidad**: Ayudar a sus dos dispositivos (host y cliente) a atravesar cortafuegos y establecer una conexión WebRTC de extremo a extremo (P2P).
- **Tratamiento**: Estos datos transitorios de protocolo de enlace de red (incluyendo IPs locales o públicas) se destruyen inmediatamente después de establecer la conexión. **El servidor de señalización del Software nunca registra ni almacena permanentemente ningún paquete de protocolo de enlace de red.**

### 2. Preferencias de la Aplicación
- **Finalidad**: Para almacenar su configuración de idioma, modo de visualización y otras preferencias para su aplicación automática en el próximo inicio.
- **Tratamiento**: Se almacena únicamente en su dispositivo localmente (iOS UserDefaults) y nunca se envía a ningún servidor.

---

## Dos. Datos que NO Recopilamos

Basándonos en la arquitectura E2EE descentralizada de 2syn, garantizamos estrictamente:

1. **Pantalla remota, vídeo y audio**: Todos los flujos se transmiten de extremo a extremo directamente entre sus dos dispositivos. Ningún tercero, incluidos nosotros, puede interceptarlos o descifrarlos.
2. **Entrada de teclado, ratón y táctil**: Todos los comandos de entrada se transmiten localmente a través de P2P y no pasan por ningún servidor.
3. **Datos de presión e inclinación del Apple Pencil**: Los datos de presión del lápiz se transmiten directamente entre dispositivos y no se retienen en ningún servidor.
4. **Información de Identificación Personal (PII)**: El Software no requiere que proporcione su nombre, dirección de correo electrónico o número de teléfono.
5. **Datos de ubicación**: El Software no accede a su GPS o ubicación precisa.
6. **Cámara o micrófono**: El cliente iOS no accede a la cámara o al micrófono.

---

## Tres. Compartición de Datos y Divulgación a Terceros

**Nunca vendemos, intercambiamos ni alquilamos** ninguna de su información a terceros.

La única excepción: Si se nos obliga legalmente (p. ej., mediante una orden judicial), podemos proporcionar legalmente los registros de conexión mínimos (marcas de tiempo de conexión) almacenados en el servidor de señalización. Sin embargo, técnicamente somos incapaces de proporcionar su pantalla remota o contenido transmitido.

---

## Cuatro. Uso de Servidores STUN

El Software utiliza servidores STUN públicos (p. ej., los proporcionados por Google) para ayudar a los dispositivos a descubrir sus direcciones IP públicas para el NAT traversal. Estos servidores solo proporcionan resolución de IP y no pueden acceder a su contenido de conexión. Sus políticas de privacidad están regidas por sus respectivos proveedores.

El Software utiliza una arquitectura solo STUN y **no utiliza servidores de retransmisión TURN de forma predeterminada**. Todas las conexiones son directas.

---

## Cinco. Seguridad de los Datos

- La comunicación de extremo a extremo utiliza los protocolos de cifrado DTLS 1.3 / SRTP integrados de WebRTC.
- Las preferencias de la aplicación se almacenan en el sandbox del sistema iOS y están protegidas por la seguridad nativa de iOS.

---

## Seis. Privacidad de los Menores

El Software está diseñado para usuarios de 13 años o más. No recopilamos conscientemente información personal de menores de 13 años.

---

## Siete. Cambios en esta Política

Si hay cambios significativos en esta política, publicaremos un anuncio dentro del Software o en nuestro sitio web oficial. El uso continuado del Software constituye su aceptación de la política actualizada.

---

## Ocho. Contáctenos

Si tiene alguna pregunta sobre esta Política de Privacidad, comuníquese con nosotros a través de la página de reseñas de la App Store o nuestros canales oficiales de atención al cliente.
