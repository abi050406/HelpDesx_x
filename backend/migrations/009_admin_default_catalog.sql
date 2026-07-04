BEGIN;

INSERT INTO configuracion_categorias(nombre_categoria, descripcion, tiempo_sla_minutos, color, icono)
VALUES
  ('Software', 'Aplicaciones, sistemas y programas', 60, '#6366F1', 'software'),
  ('Hardware', 'Equipos y periféricos', 120, '#F59E0B', 'hardware'),
  ('Redes', 'Conectividad, Internet y VPN', 45, '#0EA5E9', 'network'),
  ('Accesos', 'Cuentas, permisos y credenciales', 60, '#8B5CF6', 'key'),
  ('Otros', 'Solicitudes no clasificadas', 120, '#64748B', 'help')
ON CONFLICT (nombre_categoria) DO NOTHING;

INSERT INTO etiquetas_categoria(categoria_id, nombre, sort_order)
SELECT c.id, tag.nombre, tag.orden
FROM configuracion_categorias c
JOIN (VALUES
  ('Software','Error de acceso',1), ('Software','Aplicación caída',2), ('Software','Instalación',3), ('Software','Rendimiento',4),
  ('Hardware','Equipo no enciende',1), ('Hardware','Impresora',2), ('Hardware','Periférico',3), ('Hardware','Daño físico',4),
  ('Redes','Sin Internet',1), ('Redes','VPN caída',2), ('Redes','Wi-Fi',3), ('Redes','Servidor inaccesible',4),
  ('Accesos','Contraseña',1), ('Accesos','Permisos',2), ('Accesos','Cuenta bloqueada',3),
  ('Otros','Consulta general',1), ('Otros','Solicitud de soporte',2)
) AS tag(categoria, nombre, orden) ON tag.categoria=c.nombre_categoria
ON CONFLICT (categoria_id, nombre) DO NOTHING;

INSERT INTO preguntas_contexto(categoria_id, pregunta, legacy_key, sort_order)
SELECT c.id, '¿A cuántas personas afecta?', 'scope', 1
FROM configuracion_categorias c
WHERE NOT EXISTS (SELECT 1 FROM preguntas_contexto p WHERE p.categoria_id=c.id)
ON CONFLICT (categoria_id, legacy_key) WHERE legacy_key IS NOT NULL DO NOTHING;

INSERT INTO opciones_pregunta(pregunta_id, texto, puntaje, sort_order)
SELECT p.id, option.texto, option.puntaje, option.orden
FROM preguntas_contexto p
CROSS JOIN (VALUES ('Solo a mí',0,1), ('A un equipo',2,2), ('A toda la empresa',4,3))
  AS option(texto,puntaje,orden)
WHERE p.legacy_key='scope'
  AND NOT EXISTS (SELECT 1 FROM opciones_pregunta o WHERE o.pregunta_id=p.id);

COMMIT;
